import { getSupabaseClient } from '../lib/supabase.js';
import { upsertLeadFromShapeCall } from '../lib/leads.js';
import { insertInitialCallTranscript } from '../lib/transcripts.js';
import { assertAuthorized, readJsonBody, sendJson } from '../lib/http.js';
import { updateShapeLeadFields } from '../lib/shape/client.js';
import { normalizePayload, resolveLeadPhone } from '../lib/zoom-payload.js';
import {
  isZoomCallAnsweredPayload,
  runCallAnsweredPipeline,
} from '../lib/call-answered-pipeline.js';
import { handleZoomWebhookChallenge } from '../lib/zoom/webhook.js';
import { sendEmail } from '../lib/email/send.js';

function parseCallAnsweredPayload(body) {
  const normalized = normalizePayload(body);

  const missing = [];

  if (!normalized.shapeLeadId) {
    missing.push('shape_lead_id');
  }

  if (!normalized.callerName && !normalized.fullName) {
    missing.push('caller_name (or first_name + last_name)');
  }

  if (!normalized.callerPhone) {
    missing.push('caller_phone');
  }

  if (!normalized.calleeName && !normalized.calleePhone && !normalized.loName) {
    missing.push('callee_name, callee_phone, or lo_name');
  }

  if (!normalized.timestamp) {
    missing.push('timestamp');
  }

  if (missing.length > 0) {
    const error = new Error(`Missing required fields: ${[...new Set(missing)].join(', ')}`);
    error.statusCode = 400;
    throw error;
  }

  const { direction, formattedPhone } = resolveLeadPhone(normalized);

  if (!formattedPhone) {
    const error = new Error('Lead phone number must contain at least 10 digits.');
    error.statusCode = 400;
    throw error;
  }

  const parsedTimestamp = new Date(normalized.timestamp);

  if (Number.isNaN(parsedTimestamp.getTime())) {
    const error = new Error('timestamp must be a valid ISO date string.');
    error.statusCode = 400;
    throw error;
  }

  const leadNameRaw =
    normalized.fullName ??
    normalized.callerName ??
    (direction === 'inbound' ? normalized.callerName : normalized.calleeName) ??
    'Unknown Caller';

  const callerName =
    normalized.callerName ?? normalized.fullName ?? leadNameRaw;

  const calleeName =
    normalized.calleeName ??
    normalized.loName ??
    (normalized.calleePhone ? `Extension ${normalized.calleePhone}` : 'Unknown LO');

  const callId =
    normalized.callId ??
    (normalized.eventTs
      ? `answered-${normalized.eventTs}-${formattedPhone.replace(/\D/g, '')}`
      : `answered-${parsedTimestamp.getTime()}`);

  return {
    shapeLeadId: String(normalized.shapeLeadId).trim(),
    callId: String(callId).trim(),
    direction,
    timestamp: parsedTimestamp.toISOString(),
    fullName: String(leadNameRaw).trim(),
    phoneNumber: formattedPhone,
    email: normalized.email ?? null,
    currentAddress: normalized.currentAddress ?? null,
    city: normalized.city ?? null,
    state: normalized.state ?? null,
    zipCode: normalized.zipCode ?? null,
    companyName: normalized.companyName ?? null,
    loName: normalized.loName ?? normalized.calleeName ?? null,
    callerName,
    calleeName,
  };
}

async function runLegacyCallAnswered(supabase, body) {
  const callData = parseCallAnsweredPayload(body);

  const { lead, created, mailerMatched } = await upsertLeadFromShapeCall(supabase, {
    shapeLeadId: callData.shapeLeadId,
    fullName: callData.fullName,
    phoneNumber: callData.phoneNumber,
    email: callData.email,
    currentAddress: callData.currentAddress,
    city: callData.city,
    state: callData.state,
    zipCode: callData.zipCode,
    companyName: callData.companyName,
  });

  const { transcript, created: transcriptCreated } = await insertInitialCallTranscript(supabase, {
    lead,
    externalCallId: callData.callId,
    timestamp: callData.timestamp,
  });

  const shapeFieldsToSync = {};
  if (callData.phoneNumber) {
    shapeFieldsToSync.phone = callData.phoneNumber;
  }
  if (callData.fullName) {
    const nameParts = callData.fullName.trim().split(/\s+/);
    if (nameParts[0]) shapeFieldsToSync.firstname = nameParts[0];
    if (nameParts.length > 1) shapeFieldsToSync.lastname = nameParts.slice(1).join(' ');
  }
  if (callData.email) {
    shapeFieldsToSync.email = callData.email;
  }

  let shapeSync = { skipped: true, reason: 'No fields to sync' };
  if (Object.keys(shapeFieldsToSync).length > 0) {
    shapeSync = await updateShapeLeadFields(callData.shapeLeadId, shapeFieldsToSync);
  }

  return {
    pipeline: 'legacy',
    lead_id: lead.lead_id,
    transcript_id: transcript.transcript_id,
    shape_lead_id: callData.shapeLeadId,
    lead_created: created,
    transcript_created: transcriptCreated,
    formatted_phone: callData.phoneNumber,
    current_status_label: lead.current_status_label,
    current_status_color: lead.current_status_color,
    shape_sync: shapeSync,
    mailer_matched: mailerMatched ?? null,
  };
}

/**
 * Call answered — direct from Zoom `phone.callee_answered` or legacy Zapier flat body.
 */
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return sendJson(res, 405, { error: 'Method Not Allowed' });
  }

  try {
    const body = readJsonBody(req);

    const challenge = handleZoomWebhookChallenge(body, req);
    if (challenge) {
      return sendJson(res, 200, challenge);
    }

    assertAuthorized(req);

    const supabase = getSupabaseClient();

    if (isZoomCallAnsweredPayload(body)) {
      const result = await runCallAnsweredPipeline(supabase, body);

      let dispositionSend = { sent: false, reason: 'No disposition email built' };
      const disposition = result.disposition_email;
      if (disposition?.email_to && !result.skipped && result.shape_lead_id && !result.pending_disposition) {
        dispositionSend = await sendEmail({
          to: disposition.email_to,
          subject: disposition.email_subject,
          html: disposition.email_html,
          template: 'lo_disposition',
          meta: {
            shape_lead_id: result.shape_lead_id,
            call_id: result.call_id,
            lo_name: result.lo?.display_name || disposition.email_from_name,
            lo_email: disposition.email_to,
            email_from: disposition.email_from,
            email_from_name: disposition.email_from_name,
            email_from_display: disposition.email_from_display,
            contact_found: result.contact_found,
          },
        });

        if (dispositionSend.sent && result.transcript_id) {
          const { data: row } = await supabase
            .from('transcripts')
            .select('fields_populated')
            .eq('transcript_id', result.transcript_id)
            .maybeSingle();
          const meta = row?.fields_populated ?? {};
          await supabase
            .from('transcripts')
            .update({
              fields_populated: {
                ...meta,
                disposition_email_sent_at: new Date().toISOString(),
                pending_disposition: false,
              },
            })
            .eq('transcript_id', result.transcript_id);
        }
      }

      return sendJson(res, 200, { ...result, disposition_send: dispositionSend });
    }

    const result = await runLegacyCallAnswered(supabase, body);
    return sendJson(res, 200, result);
  } catch (error) {
    console.error('[call-answered] failed:', error);

    const statusCode = error.statusCode ?? 500;
    const message =
      statusCode === 500 ? 'Internal Server Error' : error.message ?? 'Request failed';

    return sendJson(res, statusCode, {
      error: message,
      details: error.details ?? undefined,
    });
  }
}

export const config = {
  maxDuration: 60,
};
