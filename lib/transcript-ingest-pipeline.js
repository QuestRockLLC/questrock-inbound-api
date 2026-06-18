import { parseRecordingFromZoomBody, resolveLeadContextForCall } from './lead-resolve.js';
import { fetchZoomTranscriptFromRecording } from './zoom/fetch-transcript.js';
import { resolveInboundLo } from './shape/inbound-lo-roster.js';
import { formatPhoneNumber } from './phone.js';
import { runBackgroundTranscriptJob } from './process-transcript-pipeline.js';
import { findTranscriptByExternalCallId } from './transcripts.js';
import { isRecordingCompletedEvent } from './zoom/webhook.js';
import { ingestTranscriptRow } from './transcript-ingest.js';

/**
 * True when Zoom sends recording.completed (transcript fetched via Zoom API).
 */
export function isZoomRecordingPayload(body) {
  if (!body || typeof body !== 'object') return false;
  if (body.shape_lead_id || body.shapeLeadId) return false;
  if (body.mode === 'legacy') return false;
  if (body.mode === 'full' || body.pipeline === 'full') return true;
  if (isRecordingCompletedEvent(body)) return true;
  if (body.transcript_text || body.transcriptText) return false;
  return false;
}

/**
 * Full transcript pipeline from Zoom recording.completed webhook.
 */
export async function runTranscriptIngestPipeline(supabase, body, { asyncMode = false } = {}) {
  const parsed = parseRecordingFromZoomBody(body);

  if (!parsed.callId) {
    const error = new Error('Missing call_id on recording webhook payload.');
    error.statusCode = 400;
    throw error;
  }

  const dedupeKey = `${parsed.callId}:transcript`;
  const existing = await findTranscriptByExternalCallId(supabase, dedupeKey);
  if (existing) {
    return {
      success: true,
      skipped: true,
      reason: 'duplicate_transcript',
      call_id: parsed.callId,
      transcript_id: existing.transcript_id,
    };
  }

  let transcriptText = String(body.transcript_text ?? body.transcriptText ?? '').trim();
  let fetchMeta = null;

  if (!transcriptText) {
    const fetched = await fetchZoomTranscriptFromRecording(parsed.recording);
    if (!fetched.ok) {
      if (fetched.reason === 'transcript_not_ready') {
        return {
          success: false,
          retry: true,
          reason: fetched.reason,
          message: fetched.message,
          call_id: parsed.callId,
          transcript_download_url: parsed.transcriptDownloadUrl,
        };
      }
      const error = new Error(fetched.error ?? fetched.message ?? 'Failed to fetch Zoom transcript');
      error.statusCode = fetched.reason === 'zoom_auth' ? 503 : 502;
      error.details = fetched;
      throw error;
    }
    transcriptText = fetched.transcriptText;
    fetchMeta = fetched;
  }

  const context = await resolveLeadContextForCall(supabase, {
    callId: parsed.callId,
    callerPhone: parsed.borrowerPhone,
    direction: parsed.direction,
  });

  if (!context?.lead) {
    const error = new Error(
      `No lead for call_id ${parsed.callId}. Ensure phone.callee_answered webhook hits /api/call-answered first, or borrower phone must exist in Shape.`,
    );
    error.statusCode = 404;
    throw error;
  }

  if (!context.shapeLeadId && !context.questmailPending) {
    const error = new Error(
      `Lead for call_id ${parsed.callId} has no Shape link. QuestMail calls must complete call-answered first.`,
    );
    error.statusCode = 404;
    throw error;
  }

  const lo = resolveInboundLo({
    calleeName: body.callee_name ?? body.lo_name,
    calleeExtension: body.callee_extension,
    calleePhone: parsed.calleePhone,
    acceptedByName: body.accepted_by_name,
  });

  const formattedPhone = parsed.borrowerPhone ? formatPhoneNumber(parsed.borrowerPhone) : null;
  const fullName =
    [parsed.firstName, parsed.lastName].filter(Boolean).join(' ') ||
    context.lead.full_name ||
    'Unknown Caller';

  const pipelinePayload = {
    shapeLeadId: context.shapeLeadId,
    lead: context.lead,
    questmailPending: context.questmailPending ?? false,
    callId: parsed.callId,
    transcriptText,
    timestamp: parsed.timestamp,
    loName: lo?.displayName ?? null,
    formattedPhone,
    fullName,
    asyncMode,
  };

  if (asyncMode) {
    const { lead, transcript, created } = await ingestTranscriptRow(pipelinePayload);

    return {
      success: true,
      pipeline: context.questmailPending ? 'questmail_pending' : 'full',
      async: true,
      accepted: true,
      call_id: parsed.callId,
      shape_lead_id: context.shapeLeadId,
      lead_id: lead.lead_id,
      transcript_id: transcript.transcript_id,
      transcript_created: created,
      resolved_by: context.resolvedBy,
      questmail_pending: context.questmailPending ?? false,
      zoom_fetch: fetchMeta,
      lo: lo
        ? { display_name: lo.displayName, email: lo.email, matched_by: lo.matchedBy }
        : null,
      pipeline_payload: pipelinePayload,
      message: context.questmailPending
        ? 'QuestMail transcript saved; borrower identification and AI run in background.'
        : 'Transcript saved; AI evaluation runs in background.',
    };
  }

  const result = await runBackgroundTranscriptJob(pipelinePayload);
  return {
    success: true,
    pipeline: context.questmailPending ? 'questmail_transcript' : 'full',
    async: false,
    call_id: parsed.callId,
    resolved_by: context.resolvedBy,
    questmail_pending: context.questmailPending ?? false,
    zoom_fetch: fetchMeta,
    lo: lo
      ? { display_name: lo.displayName, email: lo.email, matched_by: lo.matchedBy }
      : null,
    message:
      'AI evaluated transcript; Shape status and fields updated. Check admin email or Call Tracker for review.',
    ...result,
  };
}
