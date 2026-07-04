import { findTranscriptByExternalCallId } from '../transcripts.js';
import { sendLoDispositionEmail } from '../disposition/send-lo-email.js';
import { getInboundLoRoster } from '../shape/inbound-lo-roster.js';

function splitName(fullName) {
  const parts = String(fullName ?? '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) {
    return { firstName: 'Unknown', lastName: 'Caller' };
  }
  if (parts.length === 1) {
    return { firstName: parts[0], lastName: '' };
  }
  return { firstName: parts[0], lastName: parts.slice(1).join(' ') };
}

function resolveLoFromMeta(meta) {
  if (meta?.lo_email) {
    return {
      email: meta.lo_email,
      displayName: meta.lo_name || 'Loan Officer',
      dispositionId: meta.disposition_id || 'lo',
    };
  }
  if (meta?.lo_name) {
    const roster = getInboundLoRoster();
    const match = roster.find((row) =>
      row.names.some((n) => n.toLowerCase() === String(meta.lo_name).toLowerCase()),
    );
    if (match) {
      return {
        email: match.email,
        displayName: match.names[0],
        dispositionId: match.dispositionId,
      };
    }
  }
  return null;
}

/**
 * Send (or resend) LO disposition email from Call Tracker.
 */
export async function sendDispositionEmailFromCallTracker(supabase, callId, { forceResend = false } = {}) {
  const rawCallId = String(callId ?? '').trim();
  if (!rawCallId) {
    const error = new Error('call_id is required');
    error.statusCode = 400;
    throw error;
  }

  const answeredKey = `${rawCallId}:answered`;
  const answered = await findTranscriptByExternalCallId(supabase, answeredKey);
  if (!answered?.transcript_id) {
    const error = new Error('No call-answered row found for this call.');
    error.statusCode = 404;
    throw error;
  }

  const meta = answered.fields_populated ?? {};
  const transcript = await findTranscriptByExternalCallId(supabase, `${rawCallId}:transcript`);

  const { data: lead, error: leadError } = await supabase
    .from('leads')
    .select('shape_lead_id, full_name, phone_number, lead_source, current_status_label')
    .eq('lead_id', answered.lead_id)
    .maybeSingle();

  if (leadError) {
    throw leadError;
  }

  const shapeLeadId = lead?.shape_lead_id || meta.shape_lead_id;
  if (!shapeLeadId) {
    const error = new Error('No Shape lead id linked to this call.');
    error.statusCode = 404;
    throw error;
  }

  const lo = resolveLoFromMeta(meta);
  if (!lo?.email) {
    const error = new Error('Could not resolve LO email for this call — check lo_name on the answered row.');
    error.statusCode = 400;
    throw error;
  }

  const { firstName, lastName } = splitName(lead?.full_name ?? meta.lead_name);
  const aiStatusLabel =
    transcript?.ai_status_label ||
    meta.ai_status_label ||
    lead?.current_status_label ||
    null;

  const sendResult = await sendLoDispositionEmail(supabase, {
    callId: rawCallId,
    shapeLeadId: String(shapeLeadId),
    firstName,
    lastName,
    leadPhone: lead?.phone_number ?? meta.lead_phone ?? null,
    lo,
    callTime: meta.answered_at ?? answered.timestamp ?? null,
    aiStatusLabel,
    forceResend,
  });

  return {
    ok: true,
    call_id: rawCallId,
    shape_lead_id: shapeLeadId,
    lo_email: lo.email,
    lo_name: lo.displayName,
    disposition_email_sent_at: sendResult.sent
      ? new Date().toISOString()
      : meta.disposition_email_sent_at ?? null,
    ...sendResult,
  };
}
