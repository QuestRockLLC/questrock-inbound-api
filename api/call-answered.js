import { getSupabaseClient } from '../lib/supabase.js';
import { upsertLeadFromShapeCall } from '../lib/leads.js';
import { insertInitialCallTranscript } from '../lib/transcripts.js';
import { assertAuthorized, normalizePayload, readJsonBody, sendJson } from '../lib/http.js';
import { resolveLeadPhone } from '../lib/zoom-payload.js';
import { updateShapeLeadFields } from '../lib/shape/client.js';
import {
  isZoomCallAnsweredPayload,
  runCallAnsweredPipeline,
} from '../lib/call-answered-pipeline.js';

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
 * Call answered handler.
 *
 * **Full pipeline** (default for raw Zoom `phone.callee_answered` webhooks):
 * Shape search → create if missing → assign LO owner → Supabase → disposition email payload.
 *
 * **Legacy pipeline** (when `shape_lead_id` is already set by Zapier):
 * Supabase upsert + field sync only.
 */
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return sendJson(res, 405, { error: 'Method Not Allowed' });
  }

  try {
    assertAuthorized(req);

    const body = readJsonBody(req);
    const supabase = getSupabaseClient();

    if (isZoomCallAnsweredPayload(body)) {
      const result = await runCallAnsweredPipeline(supabase, body);
      return sendJson(res, 200, result);
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
