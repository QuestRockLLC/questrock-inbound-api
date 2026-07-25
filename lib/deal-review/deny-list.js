/** Shape fields and channels that must never receive transcript text or raw SSN/DOB. */

export const SHAPE_TRANSCRIPT_DENY_FIELDS = new Set([
  'notes_sidebar',
  'notes_sidebar_ai_note',
  'recent_notes',
  'game_plan_notes',
]);

export const REVIEW_META_DENY_SHAPE_EXPORT = new Set([
  'call_summary',
  'sales_notes',
  'ray_coaching',
  'ops_notes',
  'status_rationale',
  'questrock_analysis',
  'deal_review',
  'private_identity',
  'shape_sync',
  'deal_review_sync',
  'private_identity_sync',
]);

/**
 * Strip deny-listed keys from a Shape field payload before sync or email display.
 */
export function stripDeniedShapeFields(fields = {}) {
  const out = {};
  for (const [key, value] of Object.entries(fields)) {
    if (SHAPE_TRANSCRIPT_DENY_FIELDS.has(key)) {
      continue;
    }
    if (REVIEW_META_DENY_SHAPE_EXPORT.has(key)) {
      continue;
    }
    out[key] = value;
  }
  return out;
}

/**
 * Returns true if a string looks like it contains raw transcript body (heuristic guard).
 */
export function looksLikeTranscriptLeak(text) {
  const value = String(text ?? '').trim();
  if (value.length < 200) {
    return false;
  }
  const speakerLines = (value.match(/^[^\n:]{1,40}:\s/mg) ?? []).length;
  return speakerLines >= 4;
}
