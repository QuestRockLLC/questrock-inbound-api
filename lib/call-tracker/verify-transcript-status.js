import { detectIntakeCompleted } from './resolve-call-display.js';

function normalizeStatus(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase();
}

const GOOD_STATUSES = [
  'pitch appointment scheduled',
  'first call appointment scheduled',
  'app sent',
  'app started',
  'app completed',
  'pre-approved',
  'pre-qualified',
  'pitched',
  'contacted',
  'piped',
  'funded',
];

const NURTURE_STATUSES = ['long term nurture'];
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
    /(think about|consider everything|toss through|when i decide|shopping around|shop rates|give you a call back|i'?ll call back|call you back if|not ready yet)/i.test(
      lower,
    )
  ) {
    signals.add('shopping_or_undecided');
  }

  if (
    /(pitch appointment|present loan options|scheduled (?:for|at)|callback (?:at|on)|call you (?:back )?at|talk (?:to|with) you (?:tomorrow|at|on))/i.test(
      lower,
    )
  ) {
    signals.add('pitch_scheduled');
  }

  if (
    /(social security|ssn|date of birth|monthly income|credit score|pull(?:ed)? credit|run(?:ning)? (?:your )?credit|what do you owe|appraise)/i.test(
      lower,
    )
  ) {
    signals.add('intake_facts');
  }

  if (/(app link|application link|sent (?:you )?the app|complete the application)/i.test(lower)) {
    signals.add('app_sent');
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

  if (status.includes('application completed') || status.includes('pitch scheduled')) {
    return 'good';
  }

  if (GOOD_STATUSES.some((label) => status.includes(label))) {
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
      status: 'Long Term Nurture',
      confidence: 0.9,
      reason: 'Bankruptcy seasoning — LO explained borrower cannot refinance yet.',
    };
  }

  if (found.includes('bankruptcy_active') && /unfortunately|can'?t|cannot|wait/i.test(lower)) {
    return {
      status: 'Long Term Nurture',
      confidence: 0.8,
      reason: 'Active bankruptcy discussed with no path to proceed now.',
    };
  }

  if (found.includes('declined')) {
    return { status: 'Did Not Advance', confidence: 0.75, reason: 'Borrower declined or ended without advancing.' };
  }

  if (found.includes('app_sent')) {
    return { status: 'App Sent', confidence: 0.8, reason: 'Application link or app discussed as sent.' };
  }

  if (found.includes('pitch_scheduled') && found.includes('intake_facts')) {
    return {
      status: 'Pitch Appointment Scheduled',
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

  if (found.includes('bankruptcy')) {
    return {
      status: 'Long Term Nurture',
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
    /pitch appointment scheduled|first call appointment scheduled/i.test(reportStatus) &&
    detectIntakeCompleted(combined) &&
    !signals.includes('bankruptcy_disqualified') &&
    !signals.includes('bankruptcy_seasoning')
  ) {
    reportStatus = 'Application completed · Pitch scheduled';
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
