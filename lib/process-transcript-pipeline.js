import { getSupabaseClient } from './supabase.js';
import { findLeadByShapeId, updateLeadFromAi } from './leads.js';
import { appendTranscript, getTranscriptHistory } from './transcripts.js';
import { loadStatusDefinitions } from './status-definitions.js';
import { evaluateCallWithAi } from './ai/evaluate-call.js';
import { buildAdminOutcomeEmail } from './admin-email.js';
import { fetchShapeLead, syncShapeLeadFromEvaluation } from './shape/client.js';

/**
 * Runs AI evaluation, Supabase updates, Shape sync, and optional admin notify webhook.
 */
export async function processTranscriptPipeline(payload) {
  const supabase = getSupabaseClient();

  const lead = await findLeadByShapeId(supabase, payload.shapeLeadId);

  if (!lead) {
    const error = new Error(
      `No Supabase lead linked to shape_lead_id ${payload.shapeLeadId}. Run /api/call-answered first.`,
    );
    error.statusCode = 404;
    throw error;
  }

  const statusDefinitions = await loadStatusDefinitions(supabase);
  const [historyBefore, shapeSnapshot] = await Promise.all([
    getTranscriptHistory(supabase, lead.lead_id),
    fetchShapeLead(payload.shapeLeadId),
  ]);

  const { transcript, created } = await appendTranscript(supabase, {
    leadId: lead.lead_id,
    callSource: 'Zoom Phone',
    transcriptText: payload.transcriptText,
    timestamp: payload.timestamp,
    externalCallId: `${payload.callId}:transcript`,
    aiStatusLabel: lead.current_status_label,
    aiStatusColor: lead.current_status_color,
  });

  const history = created
    ? [...historyBefore, transcript]
    : historyBefore.length
      ? historyBefore
      : [transcript];

  const evaluation = await evaluateCallWithAi({
    lead,
    shapeLead: shapeSnapshot.lead,
    transcriptHistory: history,
    latestTranscriptText: payload.transcriptText,
    statusDefinitions,
  });

  const updatedLead = await updateLeadFromAi(supabase, lead.lead_id, evaluation);
  const shapeSync = await syncShapeLeadFromEvaluation(payload.shapeLeadId, evaluation);

  await supabase
    .from('transcripts')
    .update({
      ai_status_label: evaluation.status.status_label,
      ai_status_color: evaluation.status.color,
      fields_populated: evaluation.fieldsPopulated,
    })
    .eq('transcript_id', transcript.transcript_id);

  const notification = buildAdminOutcomeEmail({
    lead: updatedLead,
    evaluation,
    transcript,
    loName: payload.loName,
    shapeSync,
  });

  return {
    lead_id: updatedLead.lead_id,
    transcript_id: transcript.transcript_id,
    shape_lead_id: payload.shapeLeadId,
    transcript_created: created,
    ai_status_label: evaluation.status.status_label,
    ai_status_color: evaluation.status.color,
    status_rationale: evaluation.statusRationale,
    call_summary: evaluation.callSummary,
    fields_populated: evaluation.fieldsPopulated,
    shape_sync: shapeSync,
    lead: {
      full_name: updatedLead.full_name,
      phone_number: updatedLead.phone_number,
      email: updatedLead.email,
      current_status_label: updatedLead.current_status_label,
      current_status_color: updatedLead.current_status_color,
    },
    notification,
  };
}

/**
 * POSTs admin email payload to optional Zapier Catch Hook for Outlook step.
 */
export async function notifyAdminWebhook(result) {
  const url = process.env.ZAPIER_ADMIN_NOTIFY_WEBHOOK_URL;

  if (!url) {
    return { sent: false, reason: 'ZAPIER_ADMIN_NOTIFY_WEBHOOK_URL not configured' };
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...result.notification,
      lead_id: result.lead_id,
      transcript_id: result.transcript_id,
      shape_lead_id: result.shape_lead_id,
      ai_status_label: result.ai_status_label,
      call_summary: result.call_summary,
      fields_populated: result.fields_populated,
      shape_sync: result.shape_sync,
    }),
  });

  const text = await response.text();

  if (!response.ok) {
    console.error('[notify-admin] webhook failed:', response.status, text.slice(0, 500));
    return { sent: false, http_status: response.status, detail: text.slice(0, 500) };
  }

  return { sent: true, http_status: response.status };
}

export async function runBackgroundTranscriptJob(payload) {
  try {
    const result = await processTranscriptPipeline(payload);
    const notify = await notifyAdminWebhook(result);
    console.info('[zoom-transcript] background job complete', {
      lead_id: result.lead_id,
      transcript_id: result.transcript_id,
      ai_status_label: result.ai_status_label,
      notify_sent: notify.sent,
    });
    return { ...result, notify };
  } catch (error) {
    console.error('[zoom-transcript] background job failed:', error);
    throw error;
  }
}
