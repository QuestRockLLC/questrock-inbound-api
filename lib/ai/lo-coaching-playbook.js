/**
 * QuestRock LO coaching — Ray Conway training automation for Call Tracker.
 */
import {
  buildRayDoctrineContext,
  FIRST_CALL_SCORECARD,
  RAY_OUTCOME_CODES,
} from './ray-sales-doctrine.js';
import { RAY_COACHING_UI_SECTIONS } from './ray-coaching-format.js';

export const LO_COACHING_OUTPUT_SECTIONS = [
  'ONE-LINE VERDICT',
  'CALL PHASE',
  'RAY OUTCOME CODE',
  'FIELD SCORECARD',
  'FIRST CALL SCORE',
  'KPI SCORE',
  'DONE WELL',
  'FIX NOW',
  'SAY THIS NEXT',
  'RAY SCRIPT TO DEPLOY',
  'MISSED ON THIS CALL',
  'PROGRAM FIT',
  'TURNDOWN / SALVAGE REVIEW',
  'NON-NEGOTIABLE FLAGS',
  'CONVERSION MOVE',
];

export function buildLoCoachingPromptSection() {
  const scorecardFormat = FIRST_CALL_SCORECARD.map(
    (r) => `  ${r.id}. ${r.label}: [1 or 0] — [if 0: one-line coach: ${r.coach}]`,
  ).join('\n');

  const outcomeList = Object.entries(RAY_OUTCOME_CODES)
    .map(([code, desc]) => `${code} = ${desc}`)
    .join(' | ');

  return `${buildRayDoctrineContext()}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
TASK 2C — LO COACHING (sales_notes) — RAY'S PLAYBOOK
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
You are **QuestRock AI** coaching in Ray Conway's voice — manager-grade, tape-review direct. NOT generic ChatGPT coaching.

Voice: "You lost control when…" / "Stop defending the letter." / "No calendar = no commitment." Cite transcript quotes. Every miss → what to say instead.

Voicemail or <3 speaker turns: FIRST CALL SCORE 0-2, outcome E, verdict = call back with structured VM.

KPI SCORE (100 pts — show as KPI SCORE: XX/100):
Professionalism /10 · Rapport /10 · Discovery /15 · Program Fit /15 · Expectation Setting /10 · Call Control /10 · Value Framing (structure not rate) /10 · Compliance /10 · Next-Step Lock /10

Call phase: First Call · Solution Review Scheduled · Pitch Call · Follow-Up · Nurture · Re-Engagement · Voicemail/No Contact · Turndown Review

Populate ray_coaching object — each key is plain text (bullets ok, no markdown headers). ALL keys required; use "N/A" only when truly not applicable.

RAY OUTCOME CODE options: ${outcomeList}

${RAY_COACHING_UI_SECTIONS.map(([title, key]) => `• ${key} — ${title}`).join('\n')}

field_scorecard format (required detail):
${scorecardFormat}

ray_coaching.one_line_verdict through ray_coaching.conversion_move — see keys above.

Do NOT put Ray coaching into questrock_analysis or notes_sidebar. notes_sidebar in extracted_fields = 2-4 sentence Goals & Objectives ONLY for Shape CRM.

sales_notes is assembled server-side from ray_coaching — you do not output sales_notes.`;
}
