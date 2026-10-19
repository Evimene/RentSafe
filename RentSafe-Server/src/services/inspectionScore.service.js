import { flattenItems } from './inspectionTemplate.service.js';

/* ============================================================
   computeScore
   - answers: { "identity.exists": "pass" | "fail" | "partial" | "na" }
   - returns { score, categoryScores, items }
   ============================================================ */

export function computeScore(template, answers) {
  const items = flattenItems(template);
  let earned = 0;
  let applicable = 0;

  const itemsOut = [];
  const categoryEarned = {};
  const categoryApplicable = {};

  for (const item of items) {
    const answer = answers[item.key];
    if (!answer) continue; // unanswered → not included

    let itemEarned = 0;
    if (answer === 'pass')    itemEarned = item.weight;
    else if (answer === 'partial') itemEarned = item.weight * 0.5;
    else if (answer === 'fail')    itemEarned = 0;
    else if (answer === 'na')      { /* excluded from denominator */ }

    itemsOut.push({
      categoryKey: item.categoryKey,
      itemKey: item.key,
      answer,
      weight: item.weight,
      earned: itemEarned,
    });

    if (answer !== 'na') {
      earned += itemEarned;
      applicable += item.weight;
      categoryEarned[item.categoryKey] = (categoryEarned[item.categoryKey] || 0) + itemEarned;
      categoryApplicable[item.categoryKey] = (categoryApplicable[item.categoryKey] || 0) + item.weight;
    }
  }

  const score = applicable > 0
    ? Math.round((earned / applicable) * 100 * 100) / 100
    : 0;

  const categoryScores = {};
  for (const cat of template.definition.categories || []) {
    const e = categoryEarned[cat.key] || 0;
    const a = categoryApplicable[cat.key] || 0;
    categoryScores[cat.key] = a > 0 ? Math.round((e / a) * 100 * 100) / 100 : null;
  }

  return { score, categoryScores, items: itemsOut };
}

/* ============================================================
   Anti-fraud checks
   ============================================================ */

export function computeFlags({
  template, distanceM, accuracyM, durationSeconds, photosCount, selfiePresent,
}) {
  const flags = [];
  const def = template.definition;

  if (distanceM != null && distanceM > def.max_distance_m) {
    flags.push('gps_far');
  }
  if (accuracyM != null && accuracyM > def.max_accuracy_m) {
    flags.push('accuracy_low');
  }
  if (durationSeconds != null && durationSeconds < def.min_duration_minutes * 60) {
    flags.push('too_fast');
  }
  if (photosCount < def.min_photos) {
    flags.push('photos_insufficient');
  }
  if (!selfiePresent) {
    flags.push('no_selfie');
  }
  return flags;
}