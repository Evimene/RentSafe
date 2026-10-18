import { query, withTransaction } from '../db.js';
import { HttpError } from '../middleware/error.js';

export async function listSavedSearches({ userId }) {
  const { rows } = await query(
    `SELECT id, name, params, notify, last_checked_at, last_seen_total,
            created_at, updated_at
     FROM saved_searches
     WHERE user_id = $1
     ORDER BY created_at DESC`,
    [userId]
  );
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    params: r.params,
    notify: r.notify,
    lastCheckedAt: r.last_checked_at,
    lastSeenTotal: r.last_seen_total,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }));
}

export async function createSavedSearch({ userId, name, params, notify = false }) {
  if (!name || name.trim().length < 2)
    throw new HttpError(400, 'Name must be at least 2 characters');
  if (!params || typeof params !== 'object')
    throw new HttpError(400, 'params object required');

  const { rows } = await query(
    `INSERT INTO saved_searches (user_id, name, params, notify)
     VALUES ($1, $2, $3, $4)
     RETURNING id, name, params, notify, created_at`,
    [userId, name.trim(), JSON.stringify(params), Boolean(notify)]
  );
  return {
    id: rows[0].id,
    name: rows[0].name,
    params: rows[0].params,
    notify: rows[0].notify,
    createdAt: rows[0].created_at,
  };
}

export async function updateSavedSearch({ userId, id, patch }) {
  return withTransaction(async (client) => {
    const { rows } = await client.query(
      `SELECT id FROM saved_searches WHERE id = $1 AND user_id = $2`,
      [id, userId]
    );
    if (!rows[0]) throw new HttpError(404, 'Saved search not found');

    const fields = [];
    const values = [];
    if (patch.name !== undefined) {
      values.push(patch.name.trim());
      fields.push(`name = $${values.length}`);
    }
    if (patch.params !== undefined) {
      values.push(JSON.stringify(patch.params));
      fields.push(`params = $${values.length}`);
    }
    if (patch.notify !== undefined) {
      values.push(Boolean(patch.notify));
      fields.push(`notify = $${values.length}`);
    }

    if (!fields.length) return { id };

    values.push(id);
    await client.query(
      `UPDATE saved_searches SET ${fields.join(', ')}, updated_at = NOW()
       WHERE id = $${values.length}`,
      values
    );
    return { id };
  });
}

export async function deleteSavedSearch({ userId, id }) {
  const { rowCount } = await query(
    `DELETE FROM saved_searches WHERE id = $1 AND user_id = $2`,
    [id, userId]
  );
  if (!rowCount) throw new HttpError(404, 'Saved search not found');
  return { ok: true };
}