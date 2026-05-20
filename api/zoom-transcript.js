import { getSupabaseClient } from '../lib/supabase.js';
import { findLeadByShapeId, updateLeadFromAi } from '../lib/leads.js';
import {
  appendTranscript,
  getTranscriptHistory,
} from '../lib/transcripts.js';
import { loadStatusDefinitions } from '../lib/status-definitions.js';
import { evaluateCallWithAi } from '../lib/ai/evaluate-call.js';
import { buildAdminOutcomeEmail } from '../lib/admin-email.js';
import { fetchShapeLead, syncShapeLeadFromEvaluation } from '../lib/shape/client.js';
import { assertAuthorized, normalizePayload, readJsonBody, sendJson } from '../lib/http.js';
import { resolveLeadPhone } from '../lib/zoom-payload.js';

function parseTranscriptPayload(body) {
  const normalized = normalizePayload(body);

  if (!normalized.shapeLeadId) {
    const error = new Error('Missing required field: shape_lead_id');
    error.statusCode = 400;
    throw error;
  }

  if (!normalized.callId) {
    const error = new Error('Missing required field: call_id');
    error.statusCode = 400;
    throw error;
  }

  const transcriptText = String(normalized.transcriptText ?? '').trim();

  if (!transcriptText) {
    const error = new Error('Missing required field: transcript_text');
    error.statusCode = 400;
    throw error;
  }

  const parsedTimestamp = new Date(normalized.timestamp ?? Date.now());

  if (Number.isNaN(parsedTimestamp.getTime())) {
    const error = new Error('timestamp must be a valid ISO date string.');
    error.statusCode = 400;
    throw error;
  }

  const direction = String(normalized.direction ?? 'inbound').trim().toLowerCase();
  const { formattedPhone } = resolveLeadPhone(normalized);

  return {
    shapeLeadId: String(normalized.shapeLeadId).trim(),
    callId: String(normalized.callId).trim(),
    transcriptText,
    timestamp: parsedTimestamp.toISOString(),
    loName: normalized.loName ?? null,
    formattedPhone,
    fullName: normalized.fullName ?? null,
  };
}

/**
 * Zoom transcript webhook handler.
 * Appends transcript, runs AI evaluation, updates lead, returns admin email payload.
 */
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return sendJson(res, 405, { error: 'Method Not Allowed' });
  }

  try {
    assertAuthorized(req);

    const body = readJsonBody(req);
    const payload = parseTranscriptPayload(body);
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
    const historyBefore = await getTranscriptHistory(supabase, lead.lead_id);

    const shapeSnapshot = await fetchShapeLead(payload.shapeLeadId);

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

    const email = buildAdminOutcomeEmail({
      lead: updatedLead,
      evaluation,
      transcript,
      loName: payload.loName,
      shapeSync,
    });

    return sendJson(res, 200, {
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
      notification: email,
    });
  } catch (error) {
    console.error('[zoom-transcript] failed:', error);

    const statusCode = error.statusCode ?? 500;
    const message =
      statusCode === 500 ? 'Internal Server Error' : error.message ?? 'Request failed';

    return sendJson(res, statusCode, { error: message });
  }
}
