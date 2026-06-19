import {
  createChainedTranscriptHash,
  createInitialCallHash,
} from './hash.js';

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 */
export async function getLatestTranscriptForLead(supabase, leadId) {
  const { data, error } = await supabase
    .from('transcripts')
    .select('*')
    .eq('lead_id', leadId)
    .order('timestamp', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data;
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 */
export async function getTranscriptHistory(supabase, leadId) {
  const { data, error } = await supabase
    .from('transcripts')
    .select('*')
    .eq('lead_id', leadId)
    .order('timestamp', { ascending: true });

  if (error) {
    throw error;
  }

  return data ?? [];
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 */
export async function findTranscriptByExternalCallId(supabase, externalCallId) {
  const { data, error } = await supabase
    .from('transcripts')
    .select('*')
    .eq('external_call_id', externalCallId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data;
}

/**
 * Inserts the call-answered placeholder row (no transcript text yet).
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 */
export async function insertInitialCallTranscript(
  supabase,
  { lead, externalCallId, timestamp, callSource, callMeta },
) {
  const existing = await findTranscriptByExternalCallId(
    supabase,
    `${externalCallId}:answered`,
  );

  if (existing) {
    return { transcript: existing, created: false };
  }

  const hash = createInitialCallHash({
    externalCallId,
    leadId: lead.lead_id,
  });

  const { data, error } = await supabase
    .from('transcripts')
    .insert({
      lead_id: lead.lead_id,
      call_source: callSource || 'Zoom Phone',
      transcript_text: null,
      timestamp,
      previous_hash: null,
      hash,
      ai_status_label: lead.current_status_label,
      ai_status_color: lead.current_status_color,
      fields_populated: callMeta ?? null,
      external_call_id: `${externalCallId}:answered`,
    })
    .select('*')
    .single();

  if (error) {
    throw error;
  }

  return { transcript: data, created: true };
}

/**
 * Ensures a call-answered placeholder exists (Call Tracker + lead context).
 * Used when the transcript webhook arrives before callee_answered.
 */
export async function ensureCallAnsweredRow(
  supabase,
  { callId, lead, timestamp, callSource, callMeta = {} },
) {
  const normalizedCallId = String(callId ?? '').trim();
  if (!normalizedCallId || !lead?.lead_id) {
    return { transcript: null, created: false };
  }

  const existing = await findTranscriptByExternalCallId(supabase, `${normalizedCallId}:answered`);
  if (existing) {
    return { transcript: existing, created: false };
  }

  return insertInitialCallTranscript(supabase, {
    lead,
    externalCallId: normalizedCallId,
    timestamp: timestamp ?? new Date().toISOString(),
    callSource,
    callMeta: {
      event: 'call_answered',
      call_id: normalizedCallId,
      backfilled_from: 'transcript_webhook',
      ...callMeta,
    },
  });
}

/**
 * Appends a transcript row chained to the latest hash for the lead.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 */
export async function appendTranscript(supabase, input) {
  const existing = input.externalCallId
    ? await findTranscriptByExternalCallId(supabase, input.externalCallId)
    : null;

  if (existing) {
    return { transcript: existing, created: false };
  }

  const latest = await getLatestTranscriptForLead(supabase, input.leadId);
  const previousHash = latest?.hash ?? null;

  const hash = createChainedTranscriptHash({
    externalCallId: input.externalCallId,
    leadId: input.leadId,
    previousHash,
    transcriptText: input.transcriptText,
    callSource: input.callSource,
  });

  const { data, error } = await supabase
    .from('transcripts')
    .insert({
      lead_id: input.leadId,
      call_source: input.callSource,
      transcript_text: input.transcriptText,
      timestamp: input.timestamp,
      previous_hash: previousHash,
      hash,
      ai_status_label: input.aiStatusLabel,
      ai_status_color: input.aiStatusColor,
      fields_populated: input.fieldsPopulated ?? null,
      external_call_id: input.externalCallId ?? null,
    })
    .select('*')
    .single();

  if (error) {
    throw error;
  }

  return { transcript: data, created: true };
}
