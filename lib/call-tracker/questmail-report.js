import { listInboundCalls } from './list-calls.js';

const GOOD_STATUSES = new Set([
  'pitch appointment scheduled',
  'first call appointment scheduled',
  'app sent',
  'app started',
  'app completed',
  'verification docs requested',
  'pre-approved',
  'pre-qualified',
  'pitched - advance',
  'pitched & waiting',
  'pitched and waiting',
  'pitched - follow up',
  'pitched - prep package out',
  'contacted',
  'piped',
  'funded',
  'package out',
]);

const DEAD_STATUSES = new Set([
  'turndown',
  'bad lead',
  'do not call list',
  'missed appt - rescheduling',
]);

const DNA_STATUSES = new Set(['did not advance', 'not contacted']);

export function estimateDurationSeconds(transcriptText) {
  const matches = [...String(transcriptText ?? '').matchAll(/\[(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?\]/g)];
  if (!matches.length) {
    return null;
  }

  const last = matches[matches.length - 1];
  const hours = Number(last[1]);
  const minutes = Number(last[2]);
  const seconds = Number(last[3]);
  return hours * 3600 + minutes * 60 + seconds;
}

export function formatDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return null;
  }

  const total = Math.round(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;

  if (h > 0) {
    return `${h}h ${m}m`;
  }
  if (m > 0) {
    return `${m}m ${s}s`;
  }
  return `${s}s`;
}

function normalizeStatus(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase();
}

export function hadLiveConversation(call) {
  const text = String(call.transcript_text ?? '').trim();
  if (text.length < 80) {
    return false;
  }

  const lower = text.toLowerCase();
  const voicemailOnly =
    /forwarded to voicemail|at the tone|record your message/i.test(lower) &&
    !/(my name|letter|offer code|cash.out|refinance|mortgage)/i.test(lower);

  return !voicemailOnly;
}

export function categorizeQuestMailOutcome(call) {
  const status = normalizeStatus(call.ai_status_label || call.lead_status_label);
  const state = call.transcript_state;

  if (call.questmail_hold || state === 'awaiting_identification') {
    return { bucket: 'stuck', bucket_label: 'Stuck', reason: 'Awaiting mailer / offer match' };
  }

  if (!call.transcript_text && (state === 'pending' || state === 'processing')) {
    return { bucket: 'stuck', bucket_label: 'Stuck', reason: 'Awaiting transcript' };
  }

  if (call.needs_ai_analysis || state === 'needs_ai') {
    return { bucket: 'stuck', bucket_label: 'Stuck', reason: 'Transcript ready — needs AI review' };
  }

  if (DEAD_STATUSES.has(status)) {
    return { bucket: 'dead', bucket_label: 'Dead / declined', reason: call.ai_status_label || call.lead_status_label || status };
  }

  if (DNA_STATUSES.has(status)) {
    return { bucket: 'did_not_advance', bucket_label: 'Did not advance', reason: call.ai_status_label || call.lead_status_label || status };
  }

  if (status === 'long term nurture') {
    return { bucket: 'nurture', bucket_label: 'Long-term nurture', reason: call.ai_status_label || call.lead_status_label };
  }

  if (GOOD_STATUSES.has(status) || [...GOOD_STATUSES].some((label) => status.includes(label))) {
    return { bucket: 'good', bucket_label: 'Good lead / advancing', reason: call.ai_status_label || call.lead_status_label || 'Moving forward' };
  }

  if (status) {
    return { bucket: 'other', bucket_label: 'Other', reason: call.ai_status_label || call.lead_status_label };
  }

  if (hadLiveConversation(call)) {
    return { bucket: 'stuck', bucket_label: 'Stuck', reason: 'Talked — status not set yet' };
  }

  return { bucket: 'stuck', bucket_label: 'Stuck', reason: 'No conversation or status yet' };
}

function buildCustomerSummary(call) {
  return (
    call.call_summary?.trim() ||
    call.sales_notes?.trim() ||
    call.status_rationale?.trim() ||
    null
  );
}

function buildWhatsNext(call) {
  const sales = call.sales_notes?.trim();
  if (sales) {
    const lines = sales.split('\n').map((line) => line.trim()).filter(Boolean);
    const last = lines[lines.length - 1];
    if (last && last.length < 220) {
      return last;
    }
    return sales.slice(0, 220) + (sales.length > 220 ? '…' : '');
  }

  const summary = call.call_summary?.trim();
  if (summary) {
    const sentence = summary.split(/(?<=[.!?])\s+/).pop();
    return sentence?.slice(0, 220) || null;
  }

  const outcome = categorizeQuestMailOutcome(call);
  if (outcome.bucket === 'stuck') {
    return outcome.reason;
  }
  return call.ai_status_label || call.lead_status_label || null;
}

function enrichCall(call) {
  const outcome = categorizeQuestMailOutcome(call);
  const durationSec = estimateDurationSeconds(call.transcript_text);
  const talked = hadLiveConversation(call);

  return {
    ...call,
    outcome_bucket: outcome.bucket,
    outcome_label: outcome.bucket_label,
    outcome_reason: outcome.reason,
    talked,
    duration_seconds: durationSec,
    duration_display: formatDuration(durationSec),
    customer_summary: buildCustomerSummary(call),
    whats_next: buildWhatsNext(call),
    mailer_state: call.landing_page_state || call.questmail_label?.replace(/^QuestMail\s*/i, '') || null,
  };
}

function buildSummary(rows) {
  const counts = {
    total_calls: rows.length,
    talked: 0,
    good: 0,
    stuck: 0,
    did_not_advance: 0,
    nurture: 0,
    dead: 0,
    other: 0,
  };

  for (const row of rows) {
    if (row.talked) {
      counts.talked += 1;
    }
    counts[row.outcome_bucket] = (counts[row.outcome_bucket] ?? 0) + 1;
  }

  return counts;
}

/**
 * All QuestMail inbound calls in Supabase (no date window).
 */
export async function buildQuestMailReport(supabase) {
  const raw = await listInboundCalls(supabase, {
    channel: 'questmail',
    hours: 87600,
    limit: 500,
  });

  const calls = (raw.calls ?? []).map(enrichCall).sort((a, b) => {
    return new Date(b.answered_at).getTime() - new Date(a.answered_at).getTime();
  });

  return {
    generated_at: new Date().toISOString(),
    summary: buildSummary(calls),
    calls,
    count: calls.length,
  };
}
