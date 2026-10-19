import { query } from '../db.js';

export async function getActiveTemplate() {
  const { rows } = await query(
    `SELECT id, version, name, definition
     FROM inspection_templates
     WHERE is_active = TRUE
     LIMIT 1`
  );
  return rows[0] || null;
}

export function flattenItems(template) {
  const out = [];
  for (const cat of template.definition.categories || []) {
    for (const item of cat.items || []) {
      out.push({
        categoryKey: cat.key,
        categoryLabel: cat.label,
        categoryWeightPct: cat.weight_pct,
        key: item.key,
        label: item.label,
        weight: Number(item.weight),
        requirePhoto: Boolean(item.require_photo),
      });
    }
  }
  return out;
}

export function totalWeight(template) {
  return flattenItems(template).reduce((s, i) => s + i.weight, 0);
}