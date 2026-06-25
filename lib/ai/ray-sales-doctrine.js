/**
 * Ray Conway / QuestRock sales training — canonical doctrine for QuestRock AI.
 * Sources: First Call Flow (Shape), Field Scorecard, desk sheet, pitch/CD framework,
 * turndown audit, stalled-loan ops, Confidence Language Standard.
 */

export const FIRST_CALL_SCORECARD = [
  {
    id: 1,
    key: 'source_opening',
    label: 'Correct source opening',
    good: 'QuestMail, Web, or DSCR opening matched the lead source.',
    coach: 'LO sounded generic or confused about lead source.',
  },
  {
    id: 2,
    key: 'soft_landing',
    label: 'Soft landing used',
    good: 'Borrower relaxed. LO explained the review process.',
    coach: 'LO rushed into questions or sounded like a form.',
  },
  {
    id: 3,
    key: 'clarify_why',
    label: 'Clarified why they responded',
    good: 'LO found the reason behind the call.',
    coach: 'LO stayed at surface level or chased rate.',
  },
  {
    id: 4,
    key: 'destination',
    label: 'Destination identified',
    good: 'Payment, debt, cash, payoff, purchase, timeline, or investor goal clear.',
    coach: 'No clear goal before Mini App.',
  },
  {
    id: 5,
    key: 'mini_app',
    label: 'Mini App used properly',
    good: 'Right Mini App; conversational; not robotic.',
    coach: 'LO skipped key areas or read like a checklist.',
  },
  {
    id: 6,
    key: 'hot_button',
    label: 'Story/hot button captured',
    good: 'Pain, urgency, motivation, decision maker noted.',
    coach: 'Only data captured; no borrower story.',
  },
  {
    id: 7,
    key: 'credit',
    label: 'Credit attempted',
    good: 'LO explained why credit is needed and asked confidently.',
    coach: 'LO avoided credit or offered manual estimate too early.',
  },
  {
    id: 8,
    key: 'smoke',
    label: 'Smoke handled with control',
    good: 'Acknowledge → reframe → ask → return to process.',
    coach: 'LO debated, defended, or lost control.',
  },
  {
    id: 9,
    key: 'solution_review',
    label: 'Solution Review set',
    good: 'Appointment scheduled within 24 hours when possible (48h max).',
    coach: 'Vague follow-up or "I\'ll call you later."',
  },
  {
    id: 10,
    key: 'commitment',
    label: 'Commitment locked',
    good: 'Time, date, place, expectation, confirmation, Shape task.',
    coach: 'No calendar or unclear next step.',
  },
];

export const RAY_OUTCOME_CODES = {
  A: 'Review set + credit complete',
  B: 'Review set + credit pending',
  C: 'Mini App complete + nurture path',
  D: 'Not qualified / no opportunity (validate before turndown)',
  E: 'Missed call / unreachable',
};

export function buildRayDoctrineContext() {
  const scorecardLines = FIRST_CALL_SCORECARD.map(
    (row) => `${row.id}. ${row.label} — Good: ${row.good} | Coach if missing: ${row.coach}`,
  ).join('\n');

  return `RAY CONWAY / QUESTROCK SALES DOCTRINE (operationalize in every call review):

Core doctrine: The borrower gives us the destination. We build the route. Then we guide them there.
Formula: Interest + Credibility + Clarity + Commitment = Conversion (also: Interest + Credibility + Commitment for pitches).
Identity: LO is a capital advisor, not a rate quoter. Structure, execution certainty, deal quality — never lead with rate.
First call objective: NOT the full sale — earn the Solution Review. No calendar = no commitment = no deal.

8-STEP FIRST CALL FLOW (score each step 0 or 1 on first calls):
CONNECT — Energy + source control. QuestMail: "Yep, let me pull that up… reference number?" Web: online inquiry. DSCR: understand deal before quoting. Confirm name, property, source. NEVER defend letter, promise offer, or start quoting.
SOFT LANDING — "Have you worked with QuestRock before?" Explain full picture first; review not sales pitch.
CLARIFY WHY — Rate → reason. QuestMail: what about the letter? Web: what made you look today? DSCR: portfolio goal? Listen: payment/debt/cash/payoff/timing/denied elsewhere.
MINI APP — Conversation guide, not script. Capture story, hot button, property, loan, debts, income direction, assets, timeline.
CREDIT — Verified first, soft second, manual last. "Without that I would just be guessing." Do not skip by default.
HANDLE SMOKE — "I understand. Let me explain why I'm asking." Common smoke: rate only, send numbers, need to think, no credit pull, have another lender. Do not debate or quote to escape.
SET SOLUTION REVIEW — 24-hour rule. "I have three times tomorrow. Which works best?" Choice close. Not open-ended.
LOCK COMMITMENT — Time, date, place, expectation, who attends, confirmation, Shape task.

NON-NEGOTIABLES: Do not defend letter · promise offer · make call about rates · full presentation on call 1 · read Mini App like form · skip credit by default · leave calls floating.

FIELD SCORECARD (1 pt each, 10 max — 9-10 strong, 7-8 coachable, 0-6 retrain):
${scorecardLines}

RAY OUTCOME CODES (assign on first calls when possible):
A = Solution Review set + credit complete | B = Review set + credit pending | C = Mini App done + nurture | D = Not qualified (challenge turndown) | E = Missed/unreachable

QUICK SCRIPTS (use in SAY THIS NEXT when LO missed them):
Rate-to-reason: "The rate caught your attention — the real question is what you want it to do: lower payment, clean up debt, access cash, or pay off faster?"
Credit close: "The last piece I need is credit — verifies score, mortgage history, and debts. Without that I'm guessing."
Solution Review close: "I'm thinking through options. Let's set a time to go over solutions. I have three times tomorrow — which works best?"

PITCH / ADVANCED CALLS (when past first call): Diagnose → Design → Decide. Authority framing → 3 C's → calendar control. Benefits stack when numbers discussed: rate/P&I/PITI as RANGES, skipped payments, escrow refund, PMT×8 framing, principal payoff math, program fit. Ray delivery: calm advisor, one idea at a time, conversational — not stacked hype.

TURNDOWN AUDIT (when LO or borrower says dead/turndown/not interested):
Challenge unless HARD STOP: credit under 500, loan under $150k. Otherwise ask: bank statement? 1099? FHA/Carrington 500-580? LTV/down payment restructure? Credit improvement path? A turndown mention is NOT automatically valid — flag salvage opportunities.

STALLED / PIPELINE: Diagnose bottleneck (docs, UW, appraisal, borrower ghosting). 3-5 prioritized actions. Short comms template if needed. Direct, ops-focused.

CONFIDENCE LANGUAGE: Directive, leadership tone. No weak hedging. Step through smoke: isolate → solve → close. Defend structure, not rate.`;
}

export function buildRayAnalysisGuidance() {
  return `Apply Ray doctrine to questrock_analysis fields:
• context_and_participants — Lead source type (QuestMail / Web / DSCR / inbound). Which of the 8 flow steps did the call reach? LO control level.
• financial_and_loan_profile — Numbers as stated. Competing offers. Qualification signals. Hard stops vs soft barriers.
• sales_pitch_and_value — Did LO frame structure (skipped payments, escrow, consolidation) vs rate-shop? Interest + Credibility + Commitment evidence. Quote specific LO lines.
• friction_and_barriers — Smoke screens hit and how handled. Calendar/commitment gaps. State-specific (TX 50(a)(6), listed property). Turndown validity if claimed.
• next_steps_and_status — Ray outcome code (A-E) if first call. Exact calendar action. Shape task implied. If turndown — salvage path before accepting dead.`;
}
