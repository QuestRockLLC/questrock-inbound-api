import { findTranscriptByExternalCallId } from '../transcripts.js';
import { buildDispositionEmail } from '../disposition-email.js';
import { sendEmail } from '../email/send.js';
import { getInboundLoRoster } from '../shape/inbound-lo-roster.js';

function loFromMeta(meta) {
  if (!meta?.lo_email) {
    return null;
  }
  return {
    email: meta.lo_email,
    displayName: meta.lo_name || 'Loan Officer',
    dispositionId: meta.disposition_id || 'lo',
  };
}

/**
 * Send LO disposition email and mark answered row so we do not double-send.
 */
export async function sendLoDispositionEmail(supabase, {
  callId,
  shapeLeadId,
  firstName,
  lastName,
  leadPhone,
  lo,
  callTime,
  aiStatusLabel,
  baseUrl,
  forceResend = false,
}) {
  if (!lo?.email || !shapeLeadId) {
    return { sent: false, reason: 'Missing LO email or shape_lead_id' };
  }

  const answeredKey = `${callId}:answered`;
  const answered = await findTranscriptByExternalCallId(supabase, answeredKey);
  const meta = answered?.fields_populated ?? {};

  if (meta.disposition_email_sent_at && !forceResend) {
    return { sent: false, reason: 'Disposition email already sent', sent_at: meta.disposition_email_sent_at };
  }

  const disposition = buildDispositionEmail({
    leadId: shapeLeadId,
    firstName,
    lastName,
    leadPhone,
    lo,
    callTime,
    baseUrl,
    aiStatusLabel,
  });

  const sendResult = await sendEmail({
    to: disposition.email_to,
    subject: disposition.email_subject,
    html: disposition.email_html,
    template: 'lo_disposition',
    meta: {
      email_phase: 'lo_disposition',
      shape_lead_id: shapeLeadId,
      call_id: callId,
      lo_name: lo.displayName,
      lo_email: lo.email,
      email_from: disposition.email_from,
      email_from_name: disposition.email_from_name,
      email_from_display: disposition.email_from_display,
      ai_status_label: aiStatusLabel ?? null,
      ai_suggested_slug: disposition.ai_suggested_slug ?? null,
      contact_found: meta.contact_found ?? null,
      lead_name: [firstName, lastName].filter(Boolean).join(' ') || null,
      lead_phone: leadPhone ?? null,
    },
  });

  if (answered?.transcript_id && sendResult.sent) {
    const sentAt = new Date().toISOString();
    await supabase
      .from('transcripts')
      .update({
        fields_populated: {
          ...meta,
          disposition_email_sent_at: sentAt,
          pending_disposition: false,
        },
      })
      .eq('transcript_id', answered.transcript_id);
  }

  return { ...sendResult, email_to: disposition.email_to };
}

/**
 * After transcript AI — send deferred LO email when pending_disposition was set at call answered.
 */
export async function sendPendingDispositionEmailAfterAi(supabase, {
  callId,
  shapeLeadId,
  firstName,
  lastName,
  leadPhone,
  callTime,
  aiStatusLabel,
  answeredMeta,
}) {
  const meta = answeredMeta ?? {};
  if (!meta.pending_disposition) {
    return { sent: false, reason: 'No pending_disposition flag' };
  }
  if (meta.disposition_email_sent_at) {
    return { sent: false, reason: 'Already sent' };
  }

  let lo = loFromMeta(meta);
  if (!lo && meta.lo_name) {
    const roster = getInboundLoRoster();
    const match = roster.find((row) =>
      row.names.some((n) => n.toLowerCase() === String(meta.lo_name).toLowerCase()),
    );
    if (match) {
      lo = {
        email: match.email,
        displayName: match.names[0],
        dispositionId: match.dispositionId,
      };
    }
  }

  return sendLoDispositionEmail(supabase, {
    callId,
    shapeLeadId,
    firstName,
    lastName,
    leadPhone,
    lo,
    callTime: callTime ?? meta.answered_at,
    aiStatusLabel,
  });
}
