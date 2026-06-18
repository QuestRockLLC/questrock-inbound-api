import { getSupabaseClient } from './supabase.js';
import { findLeadByShapeId } from './leads.js';
import { appendTranscript } from './transcripts.js';

/**
 * Quick transcript row insert before async AI (deduped by external_call_id).
 */
export async function ingestTranscriptRow(payload) {
  const supabase = getSupabaseClient();
  let lead = payload.lead ?? null;

  if (!lead && payload.shapeLeadId) {
    lead = await findLeadByShapeId(supabase, payload.shapeLeadId);
  }

  if (!lead) {
    const error = new Error(
      payload.shapeLeadId
        ? `No Supabase lead linked to shape_lead_id ${payload.shapeLeadId}. Run /api/call-answered first.`
        : 'No Supabase lead for pending QuestMail transcript.',
    );
    error.statusCode = 404;
    throw error;
  }

  const callSource = payload.questmailPending || lead.lead_source === 'questmail' ? 'QuestMail' : 'Zoom Phone';

  const { transcript, created } = await appendTranscript(supabase, {
    leadId: lead.lead_id,
    callSource,
    transcriptText: payload.transcriptText,
    timestamp: payload.timestamp,
    externalCallId: `${payload.callId}:transcript`,
    aiStatusLabel: lead.current_status_label,
    aiStatusColor: lead.current_status_color,
  });

  return { lead, transcript, created };
}
