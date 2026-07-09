import {
  detectIntakeFactsCollected,
  detectExplicitPitchScheduled,
  detectCallbackScheduled,
} from './resolve-call-display.js';

function normalizeStatus(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase();
}

const GOOD_STATUSES = [
  'advanced',
  'first call appointment scheduled',
  'pitch appointment scheduled',
  'app sent',
  'pre-approved',
  'pre-qualified',
  'callback scheduled',
];
const NURTURE_STATUSES = ['did not advance'];
const DNA_STATUSES = ['did not advance', 'not contacted'];
const DEAD_STATUSES = ['turndown', 'bad lead', 'do not call'];

export function detectTranscriptSignals(text) {
  const raw = String(text ?? '');
  const lower = raw.toLowerCase();
  const signals = new Set();

  const voicemailOnly =
    /forwarded to voicemail|at the tone|record your message|please leave a message/i.test(lower) &&
    !/(letter|offer code|refinance|mortgage|cash.?out)/i.test(lower);
  if (voicemailOnly) {
    signals.add('voicemail');
  }

  if (/\bbankruptcy\b|\bchapter\s*(7|13)\b/i.test(lower)) {
    signals.add('bankruptcy');
  }

  if (/\bdischarg/i.test(lower) && /bankruptcy|chapter/i.test(lower)) {
    signals.add('bankruptcy_active');
  }

  if (
    /(?:can't|cannot|wouldn'?t be able|not be able|unable to|don'?t think).{0,80}(?:until|before|after|pass|wait)/i.test(
      lower,
    ) &&
    /bankruptcy|discharg|seasoning/i.test(lower)
  ) {
    signals.add('bankruptcy_disqualified');
  }

  if (
    /(?:12|twelve)\s+months?|a year|one year|seasoning/i.test(lower) &&
    /bankruptcy|discharg/i.test(lower)
  ) {
    signals.add('bankruptcy_seasoning');
  }

  if (
    /(think about|consider everything|toss through|when i decide|shopping around|shop rates|not ready yet)/i.test(
      lower,
    ) &&
    !/(application|send (?:you|it|the)|fill out|today or tomorrow|try to send|documentation|docs)/i.test(
      lower,
    )
  ) {
    signals.add('shopping_or_undecided');
  }

  if (detectExplicitPitchScheduled(lower)) {
    signals.add('explicit_pitch_scheduled');
  }

  if (detectCallbackScheduled(text)) {
    signals.add('callback_scheduled');
  }

  if (detectIntakeFactsCollected(text)) {
    signals.add('intake_facts');
  }

  if (/(app link|application link|sent (?:you )?the app|complete the application)/i.test(lower)) {
    signals.add('app_sent');
  }

  if (
    /(?:send (?:you )?(?:the )?(?:application|documentation|docs|email)|fill out|try to send).{0,40}(?:today|tomorrow)/i.test(
      lower,
    ) ||
    /(?:today|tomorrow).{0,40}(?:application|documentation|send)/i.test(lower)
  ) {
    signals.add('forward_progress');
  }

  if (
    /(?:follow up|reach out|touch base|call you back).{0,60}(?:application|received|documentation|docs)/i.test(
      lower,
    )
  ) {
    signals.add('forward_progress');
  }

  if (/(not interested|don'?t call|do not call|no thank)/i.test(lower)) {
    signals.add('declined');
  }

  if (
    /(thanks a lot|thank you\.?\s*$|have a great day)/i.test(lower.slice(-400)) &&
    signals.has('bankruptcy_disqualified')
  ) {
    signals.add('call_ended_accepting_no');
  }

  return [...signals];
}

export function statusBucket(statusLabel) {
  const status = normalizeStatus(statusLabel);
  if (!status) {
    return 'unknown';
  }

  if (GOOD_STATUSES.some((label) => status.includes(label))) {
    return 'good';
  }

  if (status.includes('application completed') || status.includes('pitch scheduled')) {
    return 'good';
  }

  if (status.includes('callback scheduled')) {
    return 'good';
  }

  if (NURTURE_STATUSES.some((label) => status.includes(label))) {
    return 'nurture';
  }

  if (DNA_STATUSES.some((label) => status.includes(label))) {
    return 'dna';
  }

  if (DEAD_STATUSES.some((label) => status.includes(label))) {
    return 'dead';
  }

  return 'other';
}

export function suggestStatusFromTranscript(text, signals = null) {
  const found = signals ?? detectTranscriptSignals(text);
  const lower = String(text ?? '').toLowerCase();

  if (found.includes('voicemail')) {
    return { status: 'Not Contacted', confidence: 0.85, reason: 'Voicemail — no live borrower conversation.' };
  }

  if (found.includes('bankruptcy_disqualified') || found.includes('bankruptcy_seasoning')) {
    return {
      status: 'Did Not Advance',
      confidence: 0.9,
      reason: 'Bankruptcy seasoning — LO explained borrower cannot refinance yet.',
    };
  }

  if (found.includes('bankruptcy_active') && /unfortunately|can'?t|cannot|wait/i.test(lower)) {
    return {
      status: 'Did Not Advance',
      confidence: 0.8,
      reason: 'Active bankruptcy discussed with no path to proceed now.',
    };
  }

  if (found.includes('declined')) {
    return { status: 'Turndown', confidence: 0.75, reason: 'Borrower declined or requested no contact.' };
  }

  if (found.includes('app_sent') || found.includes('forward_progress')) {
    return {
      status: 'Advanced',
      confidence: 0.85,
      reason: 'Application/docs path or mutual forward step on an engaged call.',
    };
  }

  if (found.includes('callback_scheduled')) {
    return {
      status: 'Advanced',
      confidence: 0.85,
      reason: 'A follow-up callback was scheduled with commitment.',
    };
  }

  if (found.includes('explicit_pitch_scheduled') && found.includes('intake_facts')) {
    return {
      status: 'Advanced',
      confidence: 0.85,
      reason: 'Intake facts collected and a follow-up pitch call was scheduled.',
    };
  }

  if (found.includes('shopping_or_undecided')) {
    return {
      status: 'Did Not Advance',
      confidence: 0.8,
      reason: 'Borrower is shopping or needs time — no commitment on this call.',
    };
  }

  if (
    /(sell(?:ing)? (?:the |my )?house|selling houses|list(?:ing)? (?:the |my )?house)/i.test(lower) &&
    /(don'?t offer|we don'?t|not something we|only refinance|refinance only)/i.test(lower)
  ) {
    return {
      status: 'Did Not Advance',
      confidence: 0.85,
      reason: 'Borrower wanted to sell — not a product QuestRock offers on this call.',
    };
  }

  if (found.includes('bankruptcy')) {
    return {
      status: 'Did Not Advance',
      confidence: 0.65,
      reason: 'Bankruptcy mentioned on the call.',
    };
  }

  return null;
}

export function verifyAiStatusAgainstTranscript({ aiStatusLabel, transcriptText, callSummary } = {}) {
  const text = String(transcriptText ?? '').trim();
  const aiStatus = String(aiStatusLabel ?? '').trim() || null;

  if (!text || text.length < 60) {
    return {
      verified: Boolean(aiStatus),
      mismatch: false,
      confidence: 0,
      ai_status: aiStatus,
      suggested_status: null,
      report_status: aiStatus || 'No status yet',
      signals: [],
      reason: 'Transcript too short to verify.',
      use_suggested: false,
    };
  }

  const combined = `${text}\n${callSummary ?? ''}`;
  const signals = detectTranscriptSignals(combined);
  const suggestion = suggestStatusFromTranscript(text, signals);
  const aiBucket = statusBucket(aiStatus);
  const suggestedStatus = suggestion?.status ?? null;
  const suggestedBucket = suggestedStatus ? statusBucket(suggestedStatus) : null;

  let mismatch = false;
  let confidence = suggestion?.confidence ?? 0;
  let reason = suggestion?.reason ?? null;

  if (suggestedStatus && suggestedBucket && aiBucket !== 'unknown' && suggestedBucket !== aiBucket) {
    mismatch = true;
  }

  if (
    (aiBucket === 'good' || /pitch appointment/i.test(aiStatus ?? '')) &&
    (signals.includes('bankruptcy_disqualified') || signals.includes('bankruptcy_seasoning'))
  ) {
    mismatch = true;
    confidence = Math.max(confidence, 0.92);
    reason = 'Transcript shows bankruptcy seasoning — status should not be advancing/pitch.';
  }

  if (
    aiBucket === 'good' &&
    signals.includes('call_ended_accepting_no') &&
    signals.includes('bankruptcy_disqualified')
  ) {
    mismatch = true;
    confidence = Math.max(confidence, 0.95);
    reason = 'Call ended with borrower accepting they cannot proceed yet (bankruptcy).';
  }

  const useSuggested = mismatch && confidence >= 0.65 && suggestedStatus;

  let reportStatus = aiStatus;
  if (useSuggested) {
    reportStatus = suggestedStatus;
  }

  if (
    reportStatus &&
    /advanced/i.test(reportStatus) &&
    !signals.includes('bankruptcy_disqualified') &&
    !signals.includes('bankruptcy_seasoning')
  ) {
    if (
      signals.includes('forward_progress') ||
      signals.includes('app_sent') ||
      (detectExplicitPitchScheduled(combined) && detectIntakeFactsCollected(combined)) ||
      detectCallbackScheduled(combined)
    ) {
      reportStatus = 'Advanced';
    }
  }

  return {
    verified: !mismatch,
    mismatch,
    confidence: useSuggested ? confidence : mismatch ? confidence : 1,
    ai_status: aiStatus,
    suggested_status: suggestedStatus,
    report_status: reportStatus || aiStatus || 'No status yet',
    signals,
    reason: mismatch ? reason : 'AI status aligns with transcript signals.',
    use_suggested: Boolean(useSuggested),
  };
}
