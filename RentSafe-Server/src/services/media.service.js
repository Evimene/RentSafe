import multer from 'multer';
import path from 'node:path';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import { query, withTransaction } from '../db.js';
import { HttpError } from '../middleware/error.js';
import { config } from '../config.js';

let sharp = null;
try { sharp = (await import('sharp')).default; } catch { /* optional */ }

const storage = multer.diskStorage({
  destination: async (req, file, cb) => {
    const dir = path.join(config.uploads.dir, 'listings');
    await fs.mkdir(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase() || '.jpg';
    cb(null, `${crypto.randomUUID()}${ext}`);
  },
});

export const upload = multer({
  storage,
  limits: { fileSize: 8 * 1024 * 1024, files: 10 },
  fileFilter: (req, file, cb) => {
    const ok = ['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype);
    cb(ok ? null : new Error('Only JPEG/PNG/WebP images allowed'), ok);
  },
});

const MAX_PHOTOS_PER_LISTING = 25;

async function makeThumbnail(inputPath) {
  if (!sharp) return null;
  try {
    const thumbDir = path.join(config.uploads.dir, 'listings', 'thumbs');
    await fs.mkdir(thumbDir, { recursive: true });
    const outName = `thumb-${path.basename(inputPath, path.extname(inputPath))}.webp`;
    const outPath = path.join(thumbDir, outName);
    await sharp(inputPath).resize(600, 400, { fit: 'cover' }).webp({ quality: 80 }).toFile(outPath);
    return `/uploads/listings/thumbs/${outName}`;
  } catch (err) {
    console.warn('[media] thumbnail failed', err.message);
    return null;
  }
}

async function getImageSize(inputPath) {
  if (!sharp) return { width: null, height: null };
  try {
    const meta = await sharp(inputPath).metadata();
    return { width: meta.width, height: meta.height };
  } catch {
    return { width: null, height: null };
  }
}

export async function attachPhotos({ host, listingId, files }) {
  const { rows } = await query(
    `SELECT host_id, status FROM listings WHERE id = $1`,
    [listingId]
  );
  if (!rows[0]) throw new HttpError(404, 'Listing not found');
  if (rows[0].host_id !== host.id) throw new HttpError(403, 'Not your listing');

  const { rows: countRows } = await query(
    `SELECT COUNT(*)::int AS c FROM listing_media WHERE listing_id = $1`,
    [listingId]
  );
  const existing = countRows[0].c;
  if (existing + files.length > MAX_PHOTOS_PER_LISTING)
    throw new HttpError(400, `Maximum ${MAX_PHOTOS_PER_LISTING} photos per listing`);

  const created = await withTransaction(async (client) => {
    const out = [];
    let sortStart = existing;
    for (const f of files) {
      const absPath = path.join(config.uploads.dir, 'listings', f.filename);
      const thumb = await makeThumbnail(absPath);
      const size = await getImageSize(absPath);
      const url = `/uploads/listings/${f.filename}`;
      const isCover = existing === 0 && out.length === 0;
      const sortOrder = sortStart++;
      const { rows: ins } = await client.query(
        `INSERT INTO listing_media
           (listing_id, media_type, url, thumbnail_url, sort_order, is_cover,
            width, height, file_size_bytes)
         VALUES ($1, 'image', $2, $3, $4, $5, $6, $7, $8)
         RETURNING *`,
        [listingId, url, thumb, sortOrder, isCover, size.width, size.height, f.size]
      );
      out.push(ins[0]);
    }
    return out;
  });

  return created.map((m) => ({
    id: m.id,
    url: m.url,
    thumbnailUrl: m.thumbnail_url,
    sortOrder: m.sort_order,
    isCover: m.is_cover,
  }));
}

export async function deletePhoto({ host, listingId, mediaId }) {
  return withTransaction(async (client) => {
    const { rows } = await client.query(
      `SELECT m.id, m.url, m.is_cover, l.host_id
       FROM listing_media m JOIN listings l ON l.id = m.listing_id
       WHERE m.id = $1 AND m.listing_id = $2`,
      [mediaId, listingId]
    );
    const m = rows[0];
    if (!m) throw new HttpError(404, 'Photo not found');
    if (m.host_id !== host.id) throw new HttpError(403, 'Not your listing');

    await client.query(`DELETE FROM listing_media WHERE id = $1`, [mediaId]);

    // If we deleted the cover, promote the next photo
    if (m.is_cover) {
      const { rows: next } = await client.query(
        `SELECT id FROM listing_media WHERE listing_id = $1 ORDER BY sort_order LIMIT 1`,
        [listingId]
      );
      if (next[0]) {
        await client.query(
          `UPDATE listing_media SET is_cover = TRUE WHERE id = $1`,
          [next[0].id]
        );
      }
    }

    // Clean up files (best-effort)
    const abs = path.join(config.uploads.dir, m.url.replace(/^\/uploads\//, ''));
    fs.unlink(abs).catch(() => {});

    return { ok: true };
  });
}

export async function setCoverPhoto({ host, listingId, mediaId }) {
  return withTransaction(async (client) => {
    const { rows } = await client.query(
      `SELECT l.host_id FROM listings l WHERE l.id = $1`,
      [listingId]
    );
    if (!rows[0]) throw new HttpError(404, 'Listing not found');
    if (rows[0].host_id !== host.id) throw new HttpError(403, 'Not your listing');

    await client.query(
      `UPDATE listing_media SET is_cover = FALSE WHERE listing_id = $1`,
      [listingId]
    );
    await client.query(
      `UPDATE listing_media SET is_cover = TRUE WHERE id = $1 AND listing_id = $2`,
      [mediaId, listingId]
    );

    return { ok: true };
  });
}