import { getSupabaseClient } from '../supabase.js';
import { updateLeadFromAi } from '../leads.js';
import { appendTranscript, getTranscriptHistory, findTranscriptByExternalCallId } from '../transcripts.js';
import { loadStatusDefinitions } from '../status-definitions.js';
import { evaluateCallWithAi } from '../ai/evaluate-call.js';
import { buildAdminOutcomeEmail } from '../admin-email.js';
import {
  fetchShapeLead,
  syncShapeLeadFromEvaluation,
  updateShapeLeadFields,
  assignShapeLeadOwner,
} from '../shape/client.js';
import { sendEmail } from '../email/send.js';
import { matchMailerLeadFromTranscript } from './match-from-transcript.js';
import { ensureMailerShapeLeadForRow } from './ensure-mailer-shape-lead.js';
import { buildDirectShapeFields, mailerDirectShapeFields } from './shape-direct-fields.js';
import { resolveInboundLo } from '../shape/inbound-lo-roster.js';
import { formatPhoneNumber, normalizePhoneDigits, isTollFreePhone } from '../phone.js';
import { sendLoDispositionEmail } from '../disposition/send-lo-email.js';
import { buildTranscriptReviewFields } from '../transcript-ai-review.js';

function loFromAnsweredMeta(meta) {
  if (!meta?.lo_email && !meta?.lo_name) {
    return null;
  }
  return {
    displayName: meta.lo_name,
    email: meta.lo_email,
    depursLo: meta.depurs_lo,
    dispositionId: meta.disposition_id,
  };
}

/**
 * QuestMail toll-free: identify borrower from transcript, then AI + Shape sync.
 */
export async function processQuestMailTranscriptPipeline(payload) {
  const supabase = getSupabaseClient();
  const lead = payload.lead;

  if (!lead?.lead_id) {
    const error = new Error('QuestMail transcript requires a pending call lead row.');
    error.statusCode = 404;
    throw error;
  }

  const answeredEarly = await findTranscriptByExternalCallId(supabase, `${payload.callId}:answered`);
  const answeredMeta = answeredEarly?.fields_populated ?? {};

  const match = await matchMailerLeadFromTranscript(
    supabase,
    payload.transcriptText,
    payload.formattedPhone,
    {
      referenceCode:
        payload.referenceCodeHint ?? lead.reference_code ?? answeredMeta.reference_code ?? null,
      mailerLeadId: payload.mailerLeadIdHint ?? answeredMeta.mailer_lead_id ?? null,
    },
  );

  if (!match.matched || !match.mailerRow) {
    const fallbackShapeLeadId = payload.shapeLeadId || lead.shape_lead_id;
    if (fallbackShapeLeadId) {
      const { processTranscriptPipeline } = await import('../process-transcript-pipeline.js');
      return processTranscriptPipeline({
        ...payload,
        shapeLeadId: String(fallbackShapeLeadId),
        questmailPending: false,
      });
    }

    const error = new Error(
      'QuestMail call could not be matched to an imported mailer lead (offer code, callback phone, address, or name). Import the mailer row or use Call Tracker → Link mailer lead.',
    );
    error.statusCode = 422;
    throw error;
  }

  const mailerRow = match.mailerRow;
  const callbackPhone =
    match.callback_phone || formatPhoneNumber(payload.formattedPhone) || lead.phone_number;
  const phoneDigits = callbackPhone ? normalizePhoneDigits(callbackPhone) : null;
  const borrowerPhone =
    callbackPhone && !isTollFreePhone(callbackPhone)
      ? callbackPhone
      : lead.phone_number && !isTollFreePhone(lead.phone_number)
        ? lead.phone_number
        : null;

  const ensured = await ensureMailerShapeLeadForRow(supabase, mailerRow, {
    phoneDigits,
    formattedPhone: callbackPhone,
  });

  if (ensured.error) {
    const error = new Error(ensured.error);
    error.statusCode = 502;
    throw error;
  }

  const shapeLeadId = ensured.shapeLeadId;
  const borrowerName =
    mailerRow.full_name ||
    [mailerRow.first_name, mailerRow.last_name].filter(Boolean).join(' ').trim() ||
    payload.fullName ||
    'Unknown Caller';

  await supabase
    .from('leads')
    .update({
      shape_lead_id: shapeLeadId,
      full_name: borrowerName,
      phone_number: borrowerPhone,
      email: mailerRow.email ?? lead.email,
      lead_source: 'questmail',
      reference_code: mailerRow.reference_code,
      updated_at: new Date().toISOString(),
    })
    .eq('lead_id', lead.lead_id);

  await supabase
    .from('mailer_leads')
    .update({
      lead_id: lead.lead_id,
      phone: borrowerPhone ?? mailerRow.phone,
      shape_lead_id: shapeLeadId,
      shape_synced_at: new Date().toISOString(),
    })
    .eq('mailer_lead_id', mailerRow.mailer_lead_id);

  const answered = answeredEarly;
  const loMeta = answeredMeta;
  const lo =
    resolveInboundLo({
      calleeName: loMeta.lo_name,
      calleeExtension: loMeta.lo_extension,
      calleePhone: loMeta.lo_phone,
    }) || loFromAnsweredMeta(loMeta);

  if (lo?.depursLo) {
    await assignShapeLeadOwner(shapeLeadId, lo.depursLo);
  }

  const statusDefinitions = await loadStatusDefinitions(supabase);
  const historyBefore = await getTranscriptHistory(supabase, lead.lead_id);
  const shapeSnapshot = await fetchShapeLead(shapeLeadId);

  const { transcript, created } = await appendTranscript(supabase, {
    leadId: lead.lead_id,
    callSource: 'QuestMail',
    transcriptText: payload.transcriptText,
    timestamp: payload.timestamp,
    externalCallId: `${payload.callId}:transcript`,
    aiStatusLabel: lead.current_status_label,
    aiStatusColor: lead.current_status_color,
  });

  const history = created ? [...historyBefore, transcript] : historyBefore.length ? historyBefore : [transcript];

  const evaluation = await evaluateCallWithAi({
    lead: {
      ...lead,
      shape_lead_id: shapeLeadId,
      full_name: borrowerName,
      reference_code: mailerRow.reference_code,
    },
    shapeLead: shapeSnapshot.lead,
    transcriptHistory: history,
    latestTranscriptText: payload.transcriptText,
    statusDefinitions,
  });

  const updatedLead = await updateLeadFromAi(supabase, lead.lead_id, evaluation);

  const directFields = {
    ...mailerDirectShapeFields(mailerRow, callbackPhone),
    ...buildDirectShapeFields({
      ...payload,
      formattedPhone: callbackPhone,
      fullName: borrowerName,
    }),
  };

  const shapeSync = await syncShapeLeadFromEvaluation(shapeLeadId, evaluation, directFields);

  if (evaluation?.callSummary) {
    await updateShapeLeadFields(shapeLeadId, {
      notes_sidebar: `QuestMail call (${mailerRow.reference_code}): ${evaluation.callSummary}`,
    });
  }

  await supabase
    .from('transcripts')
    .update({
      ai_status_label: evaluation.status.status_label,
      ai_status_color: evaluation.status.color,
      fields_populated: buildTranscriptReviewFields(evaluation, shapeSync, {
        mailer_reference_code: mailerRow.reference_code,
        questmail_identified_by: match.matched_by,
      }),
    })
    .eq('transcript_id', transcript.transcript_id);

  let dispositionSend = { sent: false, reason: 'No LO email on call' };
  if (lo?.email && loMeta.pending_disposition) {
    const parts = borrowerName.split(/\s+/);
    dispositionSend = await sendLoDispositionEmail(supabase, {
      callId: payload.callId,
      shapeLeadId,
      firstName: parts[0] ?? mailerRow.first_name,
      lastName: parts.slice(1).join(' ') || mailerRow.last_name,
      leadPhone: phoneDigits,
      lo,
      callTime: payload.timestamp,
      aiStatusLabel: evaluation.status.status_label,
    });
  }

  const notification = buildAdminOutcomeEmail({
    lead: { ...updatedLead, shape_lead_id: shapeLeadId },
    evaluation,
    transcript,
    loName: lo?.displayName ?? payload.loName,
    shapeSync,
  });

  return {
    pipeline: 'questmail_transcript',
    lead_id: updatedLead.lead_id,
    transcript_id: transcript.transcript_id,
    shape_lead_id: shapeLeadId,
    reference_code: mailerRow.reference_code,
    matched_by: match.matched_by,
    transcript_created: created,
    ai_status_label: evaluation.status.status_label,
    disposition_send: dispositionSend,
    notification,
    shape_sync: shapeSync,
    call_summary: evaluation.callSummary,
    status_rationale: evaluation.statusRationale,
    questrock_analysis: evaluation.questrockAnalysis ?? null,
    fields_populated: evaluation.fieldsPopulated,
    lead: updatedLead,
  };
}
