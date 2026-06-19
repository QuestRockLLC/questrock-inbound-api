import { findTranscriptByExternalCallId } from '../transcripts.js';
import { resolveLeadContextForCall } from '../lead-resolve.js';
import { reEvaluateTranscriptById } from '../evaluate-transcript.js';
import { notifyAdminOutcome, runBackgroundTranscriptJob } from '../process-transcript-pipeline.js';

function isQuestMailCall(context, answeredMeta) {
  return Boolean(
    context?.questmailPending ||
      answeredMeta?.call_channel === 'questmail' ||
      answeredMeta?.questmail_hold ||
      answeredMeta?.questmail_toll,
  );
}

/**
 * Run AI summary, status, coaching notes, and Shape sync for a call that already has transcript text.
 */
export async function analyzeCallTranscript(supabase, callId) {
  const normalizedCallId = String(callId ?? '').trim();
  if (!normalizedCallId) {
    const error = new Error('call_id is required');
    error.statusCode = 400;
    throw error;
  }

  const transcriptRow = await findTranscriptByExternalCallId(supabase, `${normalizedCallId}:transcript`);
  const transcriptText = transcriptRow?.transcript_text?.trim();

  if (!transcriptText) {
    const error = new Error(
      'No transcript text saved for this call yet. Use Re-fetch from Zoom first.',
    );
    error.statusCode = 404;
    throw error;
  }

  const answered = await findTranscriptByExternalCallId(supabase, `${normalizedCallId}:answered`);
  const answeredMeta = answered?.fields_populated ?? {};
  const loName = answeredMeta.lo_name ?? null;

  const context = await resolveLeadContextForCall(supabase, {
    callId: normalizedCallId,
    callerPhone: null,
  });

  if (!context?.lead) {
    const error = new Error(
      `No lead linked to call ${normalizedCallId}. Call-answered row may be missing.`,
    );
    error.statusCode = 404;
    throw error;
  }

  const shapeLeadId = context.shapeLeadId || context.lead.shape_lead_id || null;
  const questMail = isQuestMailCall(context, answeredMeta);

  if (questMail) {
    const result = await runBackgroundTranscriptJob({
      lead: context.lead,
      questmailPending: context.questmailPending ?? !shapeLeadId,
      questmailHold: answeredMeta.questmail_hold,
      callChannel: answeredMeta.call_channel,
      answeredMeta,
      shapeLeadId,
      callId: normalizedCallId,
      transcriptText,
      timestamp: transcriptRow.timestamp,
      loName,
      formattedPhone: context.lead.phone_number,
      fullName: context.lead.full_name,
      referenceCodeHint:
        context.lead.reference_code ||
        answeredMeta.reference_code ||
        null,
      mailerLeadIdHint: answeredMeta.mailer_lead_id ?? null,
    });

    return {
      ok: true,
      analyzed: true,
      pipeline: result.pipeline ?? 'questmail_transcript',
      call_id: normalizedCallId,
      shape_lead_id: result.shape_lead_id ?? shapeLeadId,
      ai_status_label: result.ai_status_label,
      status_rationale: result.status_rationale,
      call_summary: result.call_summary,
      sales_notes: result.notification?.sales_notes ?? null,
      ops_notes: result.notification?.ops_notes ?? null,
      shape_sync: result.shape_sync,
      transcript_id: result.transcript_id,
      notify_sent: result.notify?.sent ?? false,
      message: 'AI summary, coaching, and Shape sync completed.',
    };
  }

  if (!shapeLeadId) {
    const error = new Error(
      'This call has no Shape lead linked yet. Run call-answered first or link the lead in Supabase.',
    );
    error.statusCode = 422;
    throw error;
  }

  const result = await reEvaluateTranscriptById(supabase, transcriptRow.transcript_id, { loName });
  const notify = await notifyAdminOutcome(result);

  return {
    ok: true,
    analyzed: true,
    pipeline: 're_evaluate',
    call_id: normalizedCallId,
    shape_lead_id: result.shape_lead_id,
    ai_status_label: result.ai_status_label,
    status_rationale: result.status_rationale,
    call_summary: result.call_summary,
    sales_notes: result.notification?.sales_notes ?? null,
    ops_notes: result.notification?.ops_notes ?? null,
    shape_sync: result.shape_sync,
    transcript_id: result.transcript_id,
    notify_sent: notify.sent ?? false,
    message: 'AI summary, coaching, and Shape sync completed.',
  };
}
