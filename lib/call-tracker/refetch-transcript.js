import { findTranscriptByExternalCallId } from '../transcripts.js';
import { resolveLeadContextForCall } from '../lead-resolve.js';
import { fetchTranscriptForCallId } from '../zoom/fetch-recording-by-call-id.js';
import { runBackgroundTranscriptJob } from '../process-transcript-pipeline.js';

/**
 * Manually pull transcript from Zoom API and run AI pipeline (webhook missed).
 */
export async function refetchCallTranscript(supabase, callId) {
  const normalizedCallId = String(callId ?? '').trim();
  if (!normalizedCallId) {
    const error = new Error('call_id is required');
    error.statusCode = 400;
    throw error;
  }

  const existing = await findTranscriptByExternalCallId(supabase, `${normalizedCallId}:transcript`);
  if (existing?.transcript_text?.trim()) {
    return {
      ok: true,
      skipped: true,
      reason: 'already_has_transcript',
      call_id: normalizedCallId,
      transcript_id: existing.transcript_id,
      message: 'Transcript already saved for this call.',
    };
  }

  if (existing && !existing.transcript_text?.trim()) {
    await supabase.from('transcripts').delete().eq('transcript_id', existing.transcript_id);
  }

  const answered = await findTranscriptByExternalCallId(supabase, `${normalizedCallId}:answered`);
  const zoom = await fetchTranscriptForCallId(normalizedCallId);
  if (!zoom.ok) {
    const error = new Error(
      zoom.message || zoom.error || 'Could not fetch transcript from Zoom.',
    );
    error.statusCode =
      zoom.reason === 'zoom_auth'
        ? 503
        : zoom.reason === 'no_recordings' || zoom.reason === 'transcript_not_ready'
          ? 404
          : 502;
    error.details = {
      reason: zoom.reason,
      http_status: zoom.http_status,
      attempts: zoom.attempts?.map((row) => ({
        step: row.step,
        reason: row.reason,
        http_status: row.http_status,
        error: row.error,
      })),
    };
    throw error;
  }

  const context = await resolveLeadContextForCall(supabase, {
    callId: normalizedCallId,
    callerPhone: zoom.callerPhone,
  });

  if (!context?.lead) {
    const error = new Error(
      `No lead linked to call ${normalizedCallId}. Call-answered row may be missing.`,
    );
    error.statusCode = 404;
    throw error;
  }

  if (!context.shapeLeadId && !context.questmailPending) {
    const error = new Error(
      `No Shape link for call ${normalizedCallId}. QuestMail calls may still be awaiting transcript identification.`,
    );
    error.statusCode = 404;
    throw error;
  }

  const pipelinePayload = {
    shapeLeadId: context.shapeLeadId,
    lead: context.lead,
    questmailPending: context.questmailPending ?? false,
    callId: normalizedCallId,
    transcriptText: zoom.transcriptText,
    timestamp: zoom.timestamp,
    loName: answered?.fields_populated?.lo_name ?? null,
    formattedPhone: context.lead.phone_number,
    fullName: context.lead.full_name,
    referenceCodeHint: context.lead.reference_code || answered?.fields_populated?.reference_code || null,
    asyncMode: false,
  };

  const result = await runBackgroundTranscriptJob(pipelinePayload);

  return {
    ok: true,
    refetched: true,
    call_id: normalizedCallId,
    shape_lead_id: result.shape_lead_id ?? context.shapeLeadId,
    resolved_by: context.resolvedBy,
    zoom_source: zoom.zoom_source,
    ai_status_label: result.ai_status_label,
    status_rationale: result.status_rationale,
    call_summary: result.call_summary,
    shape_sync: result.shape_sync,
    transcript_id: result.transcript_id,
    notify_sent: result.notify?.sent ?? false,
    message: 'Transcript pulled from Zoom and processed.',
  };
}
