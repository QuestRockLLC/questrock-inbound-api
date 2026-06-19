import { findTranscriptByExternalCallId } from '../transcripts.js';
import { findMailerLeadById } from '../mailer/find-lead-by-address.js';
import { ensureMailerShapeLeadForRow } from '../mailer/ensure-mailer-shape-lead.js';
import { formatPhoneNumber, normalizePhoneDigits } from '../phone.js';
import { extractPhoneCandidatesFromTranscript } from '../mailer/offer-code.js';
import { extractSpokenCallbackPhones } from '../mailer/transcript-address.js';
import { analyzeCallTranscript } from './analyze-call.js';
import { searchMailerLeads } from '../mailer-lo/search.js';

function callbackPhoneFromTranscript(transcriptText, leadPhone) {
  const candidates = [
    ...extractPhoneCandidatesFromTranscript(transcriptText),
    ...extractSpokenCallbackPhones(transcriptText),
  ];
  if (candidates[0]) {
    return formatPhoneNumber(candidates[0]);
  }
  return leadPhone ? formatPhoneNumber(leadPhone) : null;
}

/**
 * Link a QuestMail call to a mailer row, update Shape/Supabase, then run AI.
 */
export async function linkCallToMailerLead(supabase, { callId, mailerLeadId, runAi = true }) {
  const normalizedCallId = String(callId ?? '').trim();
  const mailerId = String(mailerLeadId ?? '').trim();

  if (!normalizedCallId || !mailerId) {
    const error = new Error('call_id and mailer_lead_id are required');
    error.statusCode = 400;
    throw error;
  }

  const answered = await findTranscriptByExternalCallId(supabase, `${normalizedCallId}:answered`);
  if (!answered?.lead_id) {
    const error = new Error(`No call-answered row for call ${normalizedCallId}`);
    error.statusCode = 404;
    throw error;
  }

  const mailerRow = await findMailerLeadById(supabase, mailerId);
  if (!mailerRow) {
    const error = new Error(`Mailer lead not found: ${mailerId}`);
    error.statusCode = 404;
    throw error;
  }

  const { data: lead, error: leadError } = await supabase
    .from('leads')
    .select('*')
    .eq('lead_id', answered.lead_id)
    .maybeSingle();

  if (leadError || !lead) {
    const error = new Error('Supabase lead row not found for this call');
    error.statusCode = 404;
    throw leadError;
  }

  const transcriptRow = await findTranscriptByExternalCallId(supabase, `${normalizedCallId}:transcript`);
  const callbackPhone = callbackPhoneFromTranscript(transcriptRow?.transcript_text, lead.phone_number);
  const phoneDigits = callbackPhone ? normalizePhoneDigits(callbackPhone) : null;

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
    lead.full_name;

  await supabase
    .from('leads')
    .update({
      shape_lead_id: shapeLeadId,
      full_name: borrowerName,
      phone_number: callbackPhone ?? lead.phone_number,
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
      phone: callbackPhone ?? mailerRow.phone,
      shape_lead_id: shapeLeadId,
      shape_synced_at: new Date().toISOString(),
    })
    .eq('mailer_lead_id', mailerRow.mailer_lead_id);

  const answeredMeta = answered.fields_populated ?? {};
  await supabase
    .from('transcripts')
    .update({
      fields_populated: {
        ...answeredMeta,
        questmail_hold: false,
        pending_disposition: false,
        mailer_lead_id: mailerRow.mailer_lead_id,
        reference_code: mailerRow.reference_code,
        mailer_linked_by: 'call_tracker_manual',
        mailer_linked_at: new Date().toISOString(),
      },
    })
    .eq('transcript_id', answered.transcript_id);

  const linkResult = {
    ok: true,
    linked: true,
    call_id: normalizedCallId,
    mailer_lead_id: mailerRow.mailer_lead_id,
    reference_code: mailerRow.reference_code,
    shape_lead_id: shapeLeadId,
    borrower_name: borrowerName,
    callback_phone: callbackPhone,
    message: `Linked to mailer ${mailerRow.reference_code} · Shape #${shapeLeadId}`,
  };

  if (!runAi) {
    return linkResult;
  }

  if (!transcriptRow?.transcript_text?.trim()) {
    return {
      ...linkResult,
      analyzed: false,
      message: `${linkResult.message}. Add transcript, then run AI.`,
    };
  }

  const analyzed = await analyzeCallTranscript(supabase, normalizedCallId);
  return {
    ...linkResult,
    ...analyzed,
    linked: true,
  };
}

export async function searchMailerForCallTracker(supabase, query) {
  return searchMailerLeads(supabase, query, { limit: 12 });
}
