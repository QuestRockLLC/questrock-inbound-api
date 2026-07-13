/** Structured QuestRock LO coaching sections — stored in fields_populated.ray_coaching */

export const RAY_COACHING_UI_SECTIONS = [
  ['ONE-LINE VERDICT', 'one_line_verdict'],
  ['CALL PHASE', 'call_phase'],
  ['QUESTROCK AI SCORE', 'ray_outcome_code'],
  ['FIELD SCORECARD', 'field_scorecard'],
  ['FIRST CALL SCORE', 'first_call_score'],
  ['KPI SCORE', 'kpi_score'],
  ['DONE WELL', 'done_well'],
  ['FIX NOW', 'fix_now'],
  ['SAY THIS NEXT', 'say_this_next'],
  ['SCRIPT TO DEPLOY', 'ray_script'],
  ['MISSED ON THIS CALL', 'missed_on_call'],
  ['PROGRAM FIT', 'program_fit'],
  ['TURNDOWN / SALVAGE REVIEW', 'turndown_salvage'],
  ['NON-NEGOTIABLE FLAGS', 'non_negotiable_flags'],
  ['CONVERSION MOVE', 'conversion_move'],
];

/** Strip legacy Ray branding from coaching text shown in Call Tracker and emails. */
export function sanitizeLoCoachingDisplay(text) {
  if (!text || typeof text !== 'string') return text;
  return text
    .replace(/LO Coaching\s*[—–-]\s*Ray's Playbook\s*(?:\([^)]*\))?/gi, 'LO Coaching — QuestRock AI')
    .replace(/Ray's Playbook/gi, 'QuestRock AI Playbook')
    .replace(/RAY OUTCOME CODE/g, 'QUESTROCK AI OUTCOME CODE')
    .replace(/RAY SCRIPT TO DEPLOY/g, 'SCRIPT TO DEPLOY')
    .replace(/Ray Conway's voice/gi, 'QuestRock advisor tone')
    .replace(/Ray Conway/gi, 'QuestRock AI')
    .replace(/Ray coaching/gi, 'QuestRock AI coaching')
    .replace(/Ray doctrine/gi, 'QuestRock sales doctrine')
    .replace(/Ray outcome code/gi, 'QuestRock AI outcome code')
    .replace(/Ray scorecard/gi, 'QuestRock scorecard')
    .replace(/Ray delivery/gi, 'QuestRock delivery')
    .replace(/RAY CONWAY\s*\/\s*QUESTROCK/gi, 'QUESTROCK')
    .replace(/^RAY CONWAY/gm, 'QUESTROCK');
}

export function normalizeRayCoaching(raw = {}) {
  const out = {};
  for (const [, key] of RAY_COACHING_UI_SECTIONS) {
    out[key] = String(raw[key] ?? '').trim();
  }
  return out;
}

export function formatRayCoachingText(rayCoaching) {
  if (!rayCoaching || typeof rayCoaching !== 'object') return '';
  const text = RAY_COACHING_UI_SECTIONS.filter(([, key]) => String(rayCoaching[key] ?? '').trim())
    .map(([title, key]) => `${title}:\n${String(rayCoaching[key]).trim()}`)
    .join('\n\n');
  return sanitizeLoCoachingDisplay(text);
}

export function hasRayCoachingContent(rayCoaching) {
  return Boolean(formatRayCoachingText(rayCoaching));
}
