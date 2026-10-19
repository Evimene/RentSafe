import crypto from 'node:crypto';
import { query, withTransaction } from '../db.js';
import { HttpError } from '../middleware/error.js';
import { getActiveTemplate } from './inspectionTemplate.service.js';
import { computeScore, computeFlags } from './inspectionScore.service.js';
import { config } from '../config.js';

const moneyOut = (n) => (n == null ? null : Number(n));

function makeRef() {
  const y = new Date().getFullYear();
  const n = crypto.randomInt(10000, 99999);
  return `INS-${y}-${n}`;
}

/* ============================================================
   REQUEST
   ============================================================ */

export async function requestInspection({ listingId, requestedBy, requesterRole, previousInspectionId = null }) {
  const template = await getActiveTemplate();
  if (!template) throw new HttpError(500, 'No active inspection template configured');

  return withTransaction(async (client) => {
    // Verify listing + ownership (if host)
    const { rows } = await client.query(
      `SELECT l.id, l.host_id, l.status, l.verified_at, p.location
       FROM listings l JOIN properties p ON p.id = l.property_id
       WHERE l.id = $1 AND l.deleted_at IS NULL`,
      [listingId]
    );
    const listing = rows[0];
    if (!listing) throw new HttpError(404, 'Listing not found');
    if (requesterRole === 'host' && listing.host_id !== requestedBy)
      throw new HttpError(403, 'Not your listing');
    if (listing.status !== 'active')
      throw new HttpError(400, 'Only active listings can be verified');

    // No duplicate in-flight inspections
    const { rows: existing } = await client.query(
      `SELECT id FROM inspections
       WHERE listing_id = $1
         AND status IN ('requested','assigned','scheduled','in_progress','submitted')`,
      [listingId]
    );
    if (existing[0])
      throw new HttpError(409, 'An inspection is already in progress for this listing');

    const { rows: created } = await client.query(
      `INSERT INTO inspections
         (reference, listing_id, requested_by, requester_role, template_id,
          status, is_re_inspection, previous_inspection_id)
       VALUES ($1, $2, $3, $4, $5, 'requested', $6, $7)
       RETURNING *`,
      [
        makeRef(), listingId, requestedBy, requesterRole, template.id,
        Boolean(previousInspectionId), previousInspectionId,
      ]
    );

    await client.query(
      `INSERT INTO audit_logs
         (actor_id, actor_role, action, entity_type, entity_id)
       VALUES ($1, $2, 'inspection.request', 'inspection', $3)`,
      [requestedBy, requesterRole, created[0].id]
    );

    return created[0];
  });
}

/* ============================================================
   ASSIGN
   ============================================================ */

export async function assignInspector({ inspectionId, inspectorUserId, adminId, scheduledAt = null }) {
  return withTransaction(async (client) => {
    const { rows: ins } = await client.query(
      `SELECT id, status FROM inspections WHERE id = $1 FOR UPDATE`,
      [inspectionId]
    );
    if (!ins[0]) throw new HttpError(404, 'Inspection not found');
    if (!['requested', 'assigned'].includes(ins[0].status))
      throw new HttpError(409, `Cannot assign in status "${ins[0].status}"`);

    const { rows: profile } = await client.query(
      `SELECT user_id, is_active FROM inspector_profiles WHERE user_id = $1`,
      [inspectorUserId]
    );
    if (!profile[0] || !profile[0].is_active)
      throw new HttpError(400, 'Inspector is not active');

    await client.query(
      `UPDATE inspections
       SET inspector_id = $1, status = 'assigned', scheduled_at = $2,
           expires_at = NOW() + INTERVAL '48 hours',
           updated_at = NOW()
       WHERE id = $3`,
      [inspectorUserId, scheduledAt, inspectionId]
    );

    await client.query(
      `UPDATE inspector_profiles SET last_assigned_at = NOW() WHERE user_id = $1`,
      [inspectorUserId]
    );

    await client.query(
      `INSERT INTO audit_logs
         (actor_id, actor_role, action, entity_type, entity_id, after_state)
       VALUES ($1, 'admin', 'inspection.assign', 'inspection', $2, $3)`,
      [adminId, inspectionId, JSON.stringify({ inspectorUserId, scheduledAt })]
    );

    return { id: inspectionId, status: 'assigned' };
  });
}

/* ============================================================
   ACCEPT
   ============================================================ */

export async function acceptInspection({ inspectionId, inspectorUserId }) {
  const { rows } = await query(
    `UPDATE inspections
     SET status = 'scheduled', updated_at = NOW()
     WHERE id = $1 AND inspector_id = $2 AND status = 'assigned'
     RETURNING id, status, scheduled_at`,
    [inspectionId, inspectorUserId]
  );
  if (!rows[0]) throw new HttpError(404, 'Inspection not found or not assignable');
  return rows[0];
}

/* ============================================================
   START (GPS verified)
   ============================================================ */

export async function startInspection({ inspectionId, inspectorUserId, lat, lng, accuracyM }) {
  const la = Number(lat), ln = Number(lng);
  if (!Number.isFinite(la) || !Number.isFinite(ln))
    throw new HttpError(400, 'Valid lat/lng required');

  const { rows } = await query(
    `SELECT i.id, i.status, p.location,
            ST_Distance(p.location, ST_SetSRID(ST_MakePoint($3,$4),4326)::geography) AS dist_m
     FROM inspections i
     JOIN listings l ON l.id = i.listing_id
     JOIN properties p ON p.id = l.property_id
     WHERE i.id = $1 AND i.inspector_id = $2`,
    [inspectionId, inspectorUserId, ln, la]
  );
  const ins = rows[0];
  if (!ins) throw new HttpError(404, 'Inspection not found');
  if (ins.status !== 'scheduled')
    throw new HttpError(409, `Cannot start in status "${ins.status}"`);
  if (!ins.location) throw new HttpError(400, 'Property has no location');

  const dist = Number(ins.dist_m);
  if (dist > 500) {
    throw new HttpError(400,
      `You are ${Math.round(dist)}m from the property. Move closer to start the inspection.`);
  }

  await query(
    `UPDATE inspections
     SET status = 'in_progress',
         started_at = NOW(),
         started_lat = $1, started_lng = $2, started_accuracy_m = $3,
         updated_at = NOW()
     WHERE id = $4`,
    [la, ln, accuracyM || null, inspectionId]
  );

  return {
    id: inspectionId,
    status: 'in_progress',
    startedAt: new Date().toISOString(),
    distanceToPropertyM: Math.round(dist),
  };
}

/* ============================================================
   UPLOAD PHOTO (geo-tagged)
   ============================================================ */

export async function attachInspectionPhoto({
  inspectionId, inspectorUserId, file, category, itemKey, caption, lat, lng, accuracyM,
}) {
  const { rows } = await query(
    `SELECT i.status, p.location,
            ST_Distance(p.location, ST_SetSRID(ST_MakePoint($3,$4),4326)::geography) AS dist_m
     FROM inspections i
     JOIN listings l ON l.id = i.listing_id
     JOIN properties p ON p.id = l.property_id
     WHERE i.id = $1 AND i.inspector_id = $2`,
    [inspectionId, inspectorUserId, Number(lng), Number(lat)]
  );
  const ins = rows[0];
  if (!ins) throw new HttpError(404, 'Inspection not found');
  if (ins.status !== 'in_progress')
    throw new HttpError(409, 'Photos can only be added during an in-progress inspection');

  const url = `/uploads/inspections/${file.filename}`;
  const dist = ins.location ? Number(ins.dist_m) : null;

  const { rows: created } = await query(
    `INSERT INTO inspection_photos
       (inspection_id, url, category, item_key, caption,
        taken_lat, taken_lng, taken_accuracy_m, taken_at, distance_to_property_m)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW(),$9)
     RETURNING id, url, thumbnail_url, category, item_key, caption, taken_at`,
    [inspectionId, url, category || null, itemKey || null, caption || null,
     Number(lat), Number(lng), accuracyM || null, dist]
  );

  await query(
    `UPDATE inspections SET photos_count = photos_count + 1 WHERE id = $1`,
    [inspectionId]
  );

  return created[0];
}

/* ============================================================
   SUBMIT
   ============================================================ */

export async function submitInspection({
  inspectionId, inspectorUserId, answers, lat, lng, accuracyM, deviceInfo, selfieUrl,
}) {
  if (!answers || typeof answers !== 'object')
    throw new HttpError(400, 'answers object required');

  const la = Number(lat), ln = Number(lng);

  const result = await withTransaction(async (client) => {
    const { rows } = await client.query(
      `SELECT i.*, l.host_id, p.location,
              ST_Distance(p.location, ST_SetSRID(ST_MakePoint($3,$4),4326)::geography) AS dist_m,
              (SELECT COUNT(*) FROM inspection_photos WHERE inspection_id = i.id) AS photo_count
       FROM inspections i
       JOIN listings l ON l.id = i.listing_id
       JOIN properties p ON p.id = l.property_id
       WHERE i.id = $1 AND i.inspector_id = $2
       FOR UPDATE`,
      [inspectionId, inspectorUserId, ln, la]
    );
    const ins = rows[0];
    if (!ins) throw new HttpError(404, 'Inspection not found');
    if (ins.status !== 'in_progress')
      throw new HttpError(409, `Cannot submit in status "${ins.status}"`);

    const { rows: tRows } = await client.query(
      `SELECT definition FROM inspection_templates WHERE id = $1`,
      [ins.template_id]
    );
    const template = { definition: tRows[0].definition };

    const { score, categoryScores, items } = computeScore(template, answers);

    const durationSeconds = Math.round(
      (Date.now() - new Date(ins.started_at).getTime()) / 1000
    );

    const flags = computeFlags({
      template,
      distanceM: ins.dist_m != null ? Number(ins.dist_m) : null,
      accuracyM: accuracyM != null ? Number(accuracyM) : null,
      durationSeconds,
      photosCount: Number(ins.photo_count),
      selfiePresent: Boolean(selfieUrl),
    });

    // Insert normalized items
    for (const it of items) {
      await client.query(
        `INSERT INTO inspection_items
           (inspection_id, category_key, item_key, answer, weight, earned)
         VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (inspection_id, item_key) DO UPDATE
           SET answer = EXCLUDED.answer,
               earned = EXCLUDED.earned`,
        [inspectionId, it.categoryKey, it.itemKey, it.answer, it.weight, it.earned]
      );
    }

    await client.query(
      `UPDATE inspections
       SET status = 'submitted',
           submitted_at = NOW(),
           submitted_lat = $1, submitted_lng = $2, submitted_accuracy_m = $3,
           distance_to_property_m = $4,
           duration_seconds = $5,
           selfie_url = $6, selfie_lat = $1, selfie_lng = $2,
           score = $7,
           category_scores = $8,
           checklist = $9,
           answers_count = $10,
           flagged_reasons = $11,
           device_info = $12,
           updated_at = NOW()
       WHERE id = $13`,
      [
        la, ln, accuracyM || null,
        ins.dist_m != null ? Number(ins.dist_m) : null,
        durationSeconds, selfieUrl || null,
        score, JSON.stringify(categoryScores),
        JSON.stringify(answers), items.length,
        flags, JSON.stringify(deviceInfo || {}),
        inspectionId,
      ]
    );

    // Bump inspector aggregate stats
    await client.query(
      `UPDATE inspector_profiles
       SET total_inspections = total_inspections + 1,
           avg_duration_minutes = COALESCE(
             (SELECT ROUND(AVG(duration_seconds)::numeric / 60, 1)
              FROM inspections
              WHERE inspector_id = $1 AND status = 'submitted'),
             avg_duration_minutes
           )
       WHERE user_id = $1`,
      [inspectorUserId]
    );

    return { id: inspectionId, status: 'submitted', score, flags };
  });

  return result;
}

/* ============================================================
   ADMIN REVIEW
   ============================================================ */

export async function approveInspection({ inspectionId, adminId, overrideScore = null, notes = null }) {
  return withTransaction(async (client) => {
    const { rows } = await client.query(
      `SELECT i.*, l.id AS listing_id, l.host_id, ip.rate_per_inspection_kobo
       FROM inspections i
       JOIN listings l ON l.id = i.listing_id
       LEFT JOIN inspector_profiles ip ON ip.user_id = i.inspector_id
       WHERE i.id = $1 FOR UPDATE`,
      [inspectionId]
    );
    const ins = rows[0];
    if (!ins) throw new HttpError(404, 'Inspection not found');
    if (ins.status !== 'submitted')
      throw new HttpError(409, `Cannot approve in status "${ins.status}"`);

    const { rows: tRows } = await client.query(
      `SELECT definition FROM inspection_templates WHERE id = $1`,
      [ins.template_id]
    );
    const threshold = Number(tRows[0].definition.pass_threshold || 70);

    const finalScore = overrideScore != null
      ? Math.max(0, Math.min(100, Number(overrideScore)))
      : Number(ins.score);

    if (finalScore < threshold && overrideScore == null) {
      throw new HttpError(400,
        `Score ${finalScore} is below the pass threshold (${threshold}). Use overrideScore with a reason to force approval.`);
    }

    const validMonths = Number(tRows[0].definition.verification_valid_months || 12);
    const verifiedAt = new Date();

    await client.query(
      `UPDATE inspections
       SET status = 'approved',
           reviewed_by = $1, reviewed_at = NOW(), review_notes = $2,
           override_score = $3,
           updated_at = NOW()
       WHERE id = $4`,
      [adminId, notes, overrideScore, inspectionId]
    );

    await client.query(
      `UPDATE listings
       SET verification_score = $1,
           verified_at = $2,
           verified_by = $3,
           updated_at = NOW()
       WHERE id = $4`,
      [Math.round(finalScore), verifiedAt, ins.inspector_id, ins.listing_id]
    );

    // Earnings
    const rate = Number(ins.rate_per_inspection_kobo || config.inspectorRateKobo || 500000);
    await client.query(
      `INSERT INTO inspection_earnings (inspection_id, inspector_id, amount_kobo)
       VALUES ($1, $2, $3)
       ON CONFLICT (inspection_id) DO NOTHING`,
      [inspectionId, ins.inspector_id, rate]
    );

    await client.query(
      `UPDATE inspector_profiles
       SET approved_count = approved_count + 1
       WHERE user_id = $1`,
      [ins.inspector_id]
    );

    await client.query(
      `INSERT INTO audit_logs
         (actor_id, actor_role, action, entity_type, entity_id, after_state)
       VALUES ($1, 'admin', 'inspection.approve', 'inspection', $2, $3)`,
      [adminId, inspectionId,
       JSON.stringify({ finalScore, overrideScore, listingId: ins.listing_id })]
    );

    return {
      id: inspectionId,
      status: 'approved',
      finalScore,
      verifiedAt: verifiedAt.toISOString(),
      listingId: ins.listing_id,
    };
  });
}

export async function rejectInspection({ inspectionId, adminId, reason }) {
  if (!reason || reason.trim().length < 5)
    throw new HttpError(400, 'Reason required');

  return withTransaction(async (client) => {
    const { rows } = await client.query(
      `SELECT id, status, inspector_id FROM inspections WHERE id = $1 FOR UPDATE`,
      [inspectionId]
    );
    const ins = rows[0];
    if (!ins) throw new HttpError(404, 'Inspection not found');
    if (ins.status !== 'submitted')
      throw new HttpError(409, `Cannot reject in status "${ins.status}"`);

    await client.query(
      `UPDATE inspections
       SET status = 'rejected',
           reviewed_by = $1, reviewed_at = NOW(), rejection_reason = $2,
           updated_at = NOW()
       WHERE id = $3`,
      [adminId, reason, inspectionId]
    );

    if (ins.inspector_id) {
      await client.query(
        `UPDATE inspector_profiles
         SET rejected_count = rejected_count + 1
         WHERE user_id = $1`,
        [ins.inspector_id]
      );
    }

    await client.query(
      `INSERT INTO audit_logs
         (actor_id, actor_role, action, entity_type, entity_id, notes)
       VALUES ($1, 'admin', 'inspection.reject', 'inspection', $2, $3)`,
      [adminId, inspectionId, reason]
    );

    return { id: inspectionId, status: 'rejected' };
  });
}

/* ============================================================
   LIST / DETAIL
   ============================================================ */

export async function getInspectorQueue({ inspectorUserId, status = 'assigned' }) {
  const { rows } = await query(
    `SELECT i.id, i.reference, i.status, i.scheduled_at, i.started_at,
            i.submitted_at, i.score, i.flagged_reasons, i.distance_to_property_m,
            l.id AS listing_id, l.title AS listing_title,
            p.address_line1, p.city, p.neighborhood, p.state,
            ST_Y(p.location::geometry) AS lat, ST_X(p.location::geometry) AS lng,
            (SELECT url FROM listing_media WHERE listing_id = l.id AND is_cover = TRUE LIMIT 1) AS cover_url
     FROM inspections i
     JOIN listings l ON l.id = i.listing_id
     JOIN properties p ON p.id = l.property_id
     WHERE i.inspector_id = $1 AND i.status = ANY($2::inspection_status[])
     ORDER BY i.scheduled_at ASC NULLS LAST, i.created_at DESC
     LIMIT 100`,
    [inspectorUserId, Array.isArray(status) ? status : [status]]
  );

  return rows.map((r) => ({
    id: r.id,
    reference: r.reference,
    status: r.status,
    scheduledAt: r.scheduled_at,
    startedAt: r.started_at,
    submittedAt: r.submitted_at,
    score: r.score != null ? Number(r.score) : null,
    flags: r.flagged_reasons || [],
    distanceToPropertyM: r.distance_to_property_m != null ? Number(r.distance_to_property_m) : null,
    listing: {
      id: r.listing_id,
      title: r.listing_title,
      addressLine1: r.address_line1,
      city: r.city,
      neighborhood: r.neighborhood,
      state: r.state,
      lat: r.lat != null ? Number(r.lat) : null,
      lng: r.lng != null ? Number(r.lng) : null,
      coverUrl: r.cover_url,
    },
  }));
}

export async function getInspectionDetail({ inspectionId, userId, role }) {
  const { rows } = await query(
    `SELECT i.*, l.host_id, l.title AS listing_title,
            p.address_line1, p.address_line2, p.city, p.neighborhood, p.state,
            ST_Y(p.location::geometry) AS lat, ST_X(p.location::geometry) AS lng,
            t.definition AS template_definition, t.version AS template_version,
            u.first_name AS inspector_first, u.last_name AS inspector_last,
            u.phone AS inspector_phone
     FROM inspections i
     JOIN listings l ON l.id = i.listing_id
     JOIN properties p ON p.id = l.property_id
     JOIN inspection_templates t ON t.id = i.template_id
     LEFT JOIN users u ON u.id = i.inspector_id
     WHERE i.id = $1`,
    [inspectionId]
  );
  const ins = rows[0];
  if (!ins) throw new HttpError(404, 'Inspection not found');

  // Authorization
  if (role === 'inspector' && ins.inspector_id !== userId)
    throw new HttpError(403, 'Not your inspection');
  if (role === 'host' && ins.host_id !== userId)
    throw new HttpError(403, 'Not your listing');
  // admin + support can view all

  const [items, photos] = await Promise.all([
    query(
      `SELECT category_key, item_key, answer, weight, earned, notes
       FROM inspection_items WHERE inspection_id = $1 ORDER BY category_key, item_key`,
      [inspectionId]
    ),
    query(
      `SELECT id, url, thumbnail_url, category, item_key, caption,
              taken_lat, taken_lng, taken_at, distance_to_property_m
       FROM inspection_photos WHERE inspection_id = $1 ORDER BY sort_order`,
      [inspectionId]
    ),
  ]);

  // Public view (host or public): hide inspector PII, hide photos not flagged as public
  const isPrivileged = role === 'admin' || role === 'support' || role === 'inspector';

  return {
    id: ins.id,
    reference: ins.reference,
    status: ins.status,
    isReInspection: ins.is_re_inspection,
    scheduledAt: ins.scheduled_at,
    startedAt: ins.started_at,
    submittedAt: ins.submitted_at,
    reviewedAt: ins.reviewed_at,
    score: ins.score != null ? Number(ins.score) : null,
    overrideScore: ins.override_score != null ? Number(ins.override_score) : null,
    categoryScores: ins.category_scores,
    flaggedReasons: ins.flagged_reasons || [],
    durationSeconds: ins.duration_seconds,
    distanceToPropertyM: ins.distance_to_property_m != null ? Number(ins.distance_to_property_m) : null,
    reviewNotes: ins.review_notes,
    rejectionReason: ins.rejection_reason,
    selfieUrl: ins.selfie_url,
    inspector: isPrivileged ? {
      id: ins.inspector_id,
      firstName: ins.inspector_first,
      lastName: ins.inspector_last,
      phone: ins.inspector_phone,
    } : null,
    listing: {
      id: ins.listing_id,
      title: ins.listing_title,
      hostId: ins.host_id,
      addressLine1: ins.address_line1,
      addressLine2: ins.address_line2,
      city: ins.city,
      neighborhood: ins.neighborhood,
      state: ins.state,
      lat: ins.lat != null ? Number(ins.lat) : null,
      lng: ins.lng != null ? Number(ins.lng) : null,
    },
    template: {
      version: ins.template_version,
      definition: ins.template_definition,
    },
    items: items.rows,
    photos: photos.rows.map((p) => ({
      id: p.id,
      url: p.url,
      thumbnailUrl: p.thumbnail_url,
      category: p.category,
      itemKey: p.item_key,
      caption: p.caption,
      takenLat: p.taken_lat != null ? Number(p.taken_lat) : null,
      takenLng: p.taken_lng != null ? Number(p.taken_lng) : null,
      takenAt: p.taken_at,
      distanceToPropertyM: p.distance_to_property_m != null ? Number(p.distance_to_property_m) : null,
    })),
  };
}

export async function listAdminInspections({ status = 'submitted', page = 1, pageSize = 20 }) {
  const p = Math.max(1, Number(page));
  const ps = Math.min(100, Number(pageSize));
  const offset = (p - 1) * ps;

  const where = status === 'all' ? '' : 'WHERE i.status = $3::inspection_status';
  const baseParams = status === 'all' ? [] : [status];
  const params = [...baseParams, ps, offset];

  const countRes = await query(
    `SELECT COUNT(*)::int AS total FROM inspections i ${where}`,
    baseParams
  );

  const { rows } = await query(
    `SELECT i.id, i.reference, i.status, i.score, i.flagged_reasons,
            i.submitted_at, i.created_at,
            l.id AS listing_id, l.title AS listing_title,
            p.city, p.neighborhood,
            u.first_name AS inspector_first, u.last_name AS inspector_last,
            (SELECT url FROM listing_media WHERE listing_id = l.id AND is_cover = TRUE LIMIT 1) AS cover_url
     FROM inspections i
     JOIN listings l ON l.id = i.listing_id
     JOIN properties p ON p.id = l.property_id
     LEFT JOIN users u ON u.id = i.inspector_id
     ${where}
     ORDER BY
       CASE i.status WHEN 'submitted' THEN 0 WHEN 'in_progress' THEN 1 ELSE 2 END,
       i.created_at DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );

  return {
    data: rows.map((r) => ({
      id: r.id,
      reference: r.reference,
      status: r.status,
      score: r.score != null ? Number(r.score) : null,
      flags: r.flagged_reasons || [],
      submittedAt: r.submitted_at,
      createdAt: r.created_at,
      listing: {
        id: r.listing_id,
        title: r.listing_title,
        city: r.city,
        neighborhood: r.neighborhood,
        coverUrl: r.cover_url,
      },
      inspector: r.inspector_first ? {
        firstName: r.inspector_first,
        lastName: r.inspector_last,
      } : null,
    })),
    pagination: { page: p, pageSize: ps, total: countRes.rows[0].total },
  };
}

/* ============================================================
   PUBLIC SUMMARY (for listing detail page)
   ============================================================ */

export async function getPublicInspectionSummary({ listingId }) {
  const { rows } = await query(
    `SELECT i.id, i.score, i.category_scores, i.reviewed_at,
            t.definition->>'pass_threshold' AS pass_threshold,
            t.definition->>'verification_valid_months' AS valid_months
     FROM inspections i
     JOIN inspection_templates t ON t.id = i.template_id
     WHERE i.listing_id = $1 AND i.status = 'approved'
     ORDER BY i.reviewed_at DESC
     LIMIT 1`,
    [listingId]
  );
  const ins = rows[0];
  if (!ins) return { verified: false };

  const score = ins.override_score != null ? Number(ins.override_score) : Number(ins.score);
  const threshold = Number(ins.pass_threshold || 70);
  const verified = score >= threshold;

  return {
    verified,
    score,
    categoryScores: ins.category_scores || {},
    verifiedAt: ins.reviewed_at,
    expiresAt: ins.reviewed_at && ins.valid_months
      ? new Date(new Date(ins.reviewed_at).setMonth(
          new Date(ins.reviewed_at).getMonth() + Number(ins.valid_months))).toISOString()
      : null,
  };
}