import { findTranscriptByExternalCallId, appendTranscript, ensureCallAnsweredRow } from '../transcripts.js';
import { resolveLeadContextForCall } from '../lead-resolve.js';
import { runBackgroundTranscriptJob } from '../process-transcript-pipeline.js';

/**
 * Save a manually pasted Zoom transcript and optionally run AI + Shape sync.
 */
export async function pasteCallTranscript(
  supabase,
  { callId, transcriptText, runAi = true, force = false },
) {
  const normalizedCallId = String(callId ?? '').trim();
  const text = String(transcriptText ?? '').trim();

  if (!normalizedCallId) {
    const error = new Error('call_id is required');
    error.statusCode = 400;
    throw error;
  }

  if (text.length < 40) {
    const error = new Error('Pasted transcript is too short. Paste the full Zoom transcript text.');
    error.statusCode = 400;
    throw error;
  }

  let answered = await findTranscriptByExternalCallId(supabase, `${normalizedCallId}:answered`);
  const existing = await findTranscriptByExternalCallId(supabase, `${normalizedCallId}:transcript`);

  if (!answered?.lead_id && existing?.lead_id) {
    const { data: leadRow } = await supabase
      .from('leads')
      .select('*')
      .eq('lead_id', existing.lead_id)
      .maybeSingle();

    if (leadRow) {
      await ensureCallAnsweredRow(supabase, {
        callId: normalizedCallId,
        lead: leadRow,
        timestamp: existing.timestamp ?? new Date().toISOString(),
        callSource: leadRow.lead_source === 'questmail' ? 'QuestMail' : 'Zoom Phone',
        callMeta: {
          call_channel: leadRow.lead_source === 'questmail' ? 'questmail' : 'inbound_zoom',
          backfilled_from: 'call_tracker_paste',
          shape_lead_id: leadRow.shape_lead_id ?? null,
          reference_code: leadRow.reference_code ?? null,
        },
      });
      answered = await findTranscriptByExternalCallId(supabase, `${normalizedCallId}:answered`);
    }
  }

  if (!answered?.lead_id) {
    const error = new Error(
      `No call-answered row for call ${normalizedCallId}. The call must hit /api/call-answered first, or link a lead via transcript.`,
    );
    error.statusCode = 404;
    throw error;
  }

  if (existing?.transcript_text?.trim() && !force) {
    return {
      ok: true,
      skipped: true,
      reason: 'already_has_transcript',
      call_id: normalizedCallId,
      transcript_id: existing.transcript_id,
      message: 'Transcript already saved. Use Run AI or check "Replace existing" to overwrite.',
    };
  }

  if (existing) {
    await supabase.from('transcripts').delete().eq('transcript_id', existing.transcript_id);
  }

  const context = await resolveLeadContextForCall(supabase, {
    callId: normalizedCallId,
    callerPhone: null,
  });

  if (!context?.lead) {
    const error = new Error(`No lead linked to call ${normalizedCallId}.`);
    error.statusCode = 404;
    throw error;
  }

  const answeredMeta = answered.fields_populated ?? {};
  const timestamp = answered.timestamp ?? new Date().toISOString();
  const callSource =
    answeredMeta.call_channel === 'questmail' || context.questmailPending ? 'QuestMail' : 'Zoom Phone';

  const { transcript, created } = await appendTranscript(supabase, {
    leadId: context.lead.lead_id,
    callSource,
    transcriptText: text,
    timestamp,
    externalCallId: `${normalizedCallId}:transcript`,
    aiStatusLabel: context.lead.current_status_label,
    aiStatusColor: context.lead.current_status_color,
    fieldsPopulated: { pasted_from_zoom: true, paste_source: 'call_tracker' },
  });

  if (!runAi) {
    return {
      ok: true,
      pasted: true,
      call_id: normalizedCallId,
      transcript_id: transcript.transcript_id,
      transcript_created: created,
      lead_id: context.lead.lead_id,
      message: 'Transcript saved. Run AI summary & coaching when ready.',
    };
  }

  const shapeLeadId = context.shapeLeadId || context.lead.shape_lead_id || null;
  if (!shapeLeadId && !context.questmailPending && answeredMeta.call_channel !== 'questmail') {
    const error = new Error('No Shape lead linked for this call — cannot run AI sync.');
    error.statusCode = 422;
    throw error;
  }

  const result = await runBackgroundTranscriptJob({
    shapeLeadId,
    lead: context.lead,
    questmailPending:
      context.questmailPending ?? (answeredMeta.call_channel === 'questmail' && !shapeLeadId),
    callId: normalizedCallId,
    transcriptText: text,
    timestamp,
    loName: answeredMeta.lo_name ?? null,
    formattedPhone: context.lead.phone_number,
    fullName: context.lead.full_name,
    referenceCodeHint: context.lead.reference_code || answeredMeta.reference_code || null,
  });

  return {
    ok: true,
    pasted: true,
    analyzed: true,
    call_id: normalizedCallId,
    transcript_id: transcript.transcript_id,
    shape_lead_id: result.shape_lead_id ?? shapeLeadId,
    ai_status_label: result.ai_status_label,
    status_rationale: result.status_rationale,
    call_summary: result.call_summary,
    shape_sync: result.shape_sync,
    notify_sent: result.notify?.sent ?? false,
    message: 'Pasted transcript saved and AI analysis completed.',
  };
}
