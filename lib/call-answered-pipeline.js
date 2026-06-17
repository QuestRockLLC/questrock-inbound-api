import { formatPhoneNumber, normalizePhoneDigits } from './phone.js';
import { unwrapZoomBody } from './zoom-payload.js';
import { splitFullName } from './name.js';
import { searchShapeLeadByPhone } from './shape/search-lead-by-phone.js';
import {
  assignShapeLeadOwner,
  createShapeInboundLead,
  updateShapeLeadFields,
} from './shape/client.js';
import { resolveInboundLo } from './shape/inbound-lo-roster.js';
import { upsertLeadFromShapeCall } from './leads.js';
import { findTranscriptByExternalCallId, insertInitialCallTranscript } from './transcripts.js';
import { buildDispositionEmail } from './disposition-email.js';

/**
 * True when Zap sends raw Zoom phone.callee_answered payload (no pre-built shape_lead_id).
 */
export function isZoomCallAnsweredPayload(body) {
  if (!body || typeof body !== 'object') return false;
  if (body.shape_lead_id || body.shapeLeadId) return false;
  if (body.mode === 'legacy') return false;
  if (body.mode === 'full' || body.pipeline === 'full') return true;
  if (body.event === 'phone.callee_answered') return true;
  if (body.payload?.object?.caller || body.payload?.object?.callee) return true;
  return false;
}

/**
 * Parse Zoom callee_answered webhook into a normalized call context.
 */
export function parseZoomCallAnswered(body) {
  const zoom = unwrapZoomBody(body);
  const payloadObject = body.payload?.object ?? {};

  const caller = payloadObject.caller ?? {};
  const callee = payloadObject.callee ?? {};

  const callerPhone = zoom.callerPhone ?? caller.phone_number ?? body.caller_phone;
  const calleeName = zoom.calleeName ?? callee.name ?? body.callee_name ?? body.accepted_by_name;
  const calleeExtension =
    callee.extension_number ??
    callee.extensionNumber ??
    body.callee_extension ??
    body.callee_extension_number;
  const calleePhone = zoom.calleePhone ?? callee.phone_number ?? body.callee_phone;

  const timestamp =
    zoom.timestamp ??
    payloadObject.answer_start_time ??
    payloadObject.ringing_start_time ??
    body.answer_start_time ??
    new Date().toISOString();

  const callId =
    zoom.callId ??
    payloadObject.call_id ??
    payloadObject.callId ??
    body.call_id ??
    `answered-${Date.now()}-${normalizePhoneDigits(callerPhone) || 'unknown'}`;

  const callerName = zoom.callerName ?? body.caller_name ?? '';
  const split = splitFullName(callerName);

  return {
    event: body.event ?? 'phone.callee_answered',
    callId: String(callId),
    callerPhone,
    callerName,
    callerFirstName: split.firstName,
    callerLastName: split.lastName,
    calleeName,
    calleeExtension: calleeExtension ? String(calleeExtension).replace(/\D/g, '') : '',
    calleePhone,
    timestamp: new Date(timestamp).toISOString(),
    forwardedByName: payloadObject.forwarded_by?.name ?? body.forwarded_by_name ?? null,
  };
}

/**
 * Full call-answered pipeline: Shape search/create → assign owner → Supabase → disposition email.
 */
export async function runCallAnsweredPipeline(supabase, body) {
  const zoom = parseZoomCallAnswered(body);

  const formattedPhone = formatPhoneNumber(zoom.callerPhone);
  const phoneDigits = normalizePhoneDigits(zoom.callerPhone);

  if (!formattedPhone || phoneDigits.length !== 10) {
    const error = new Error('Borrower phone must contain at least 10 digits.');
    error.statusCode = 400;
    throw error;
  }

  const dedupeKey = `${zoom.callId}:answered`;
  const existingTranscript = await findTranscriptByExternalCallId(supabase, dedupeKey);
  if (existingTranscript) {
    return {
      success: true,
      skipped: true,
      reason: 'duplicate_call',
      call_id: zoom.callId,
      transcript_id: existingTranscript.transcript_id,
    };
  }

  let contactFound = false;
  let shapeLeadId;
  let firstName = zoom.callerFirstName || 'WIRELESS';
  let lastName = zoom.callerLastName || 'CALLER';
  let email = '';

  const search = await searchShapeLeadByPhone(zoom.callerPhone);
  if (search.found && search.leadId) {
    contactFound = true;
    shapeLeadId = search.leadId;
    firstName = search.firstName || firstName;
    lastName = search.lastName || lastName;
    email = search.email || '';
  } else {
    const created = await createShapeInboundLead({
      firstname: firstName,
      lastname: lastName,
      phone: phoneDigits,
    });

    if (!created.created || !created.shape_lead_id) {
      const error = new Error(created.error ?? 'Failed to create Shape lead');
      error.statusCode = 502;
      error.details = created;
      throw error;
    }

    shapeLeadId = created.shape_lead_id;
  }

  const lo = resolveInboundLo({
    calleeName: zoom.calleeName,
    calleeExtension: zoom.calleeExtension,
    calleePhone: zoom.calleePhone,
    acceptedByName: zoom.calleeName,
  });

  let ownerAssign = { synced: false, skipped: true, reason: 'LO not resolved' };
  if (lo?.depursLo) {
    ownerAssign = await assignShapeLeadOwner(shapeLeadId, lo.depursLo);
  }

  const fullName = [firstName, lastName].filter(Boolean).join(' ').trim() || 'Unknown Caller';

  const { lead, created: leadCreated, mailerMatched } = await upsertLeadFromShapeCall(supabase, {
    shapeLeadId,
    fullName,
    phoneNumber: formattedPhone,
    email: email || null,
  });

  const { transcript, created: transcriptCreated } = await insertInitialCallTranscript(supabase, {
    lead,
    externalCallId: zoom.callId,
    timestamp: zoom.timestamp,
  });

  const shapeFieldsToSync = { phone: formattedPhone };
  if (firstName) shapeFieldsToSync.firstname = firstName;
  if (lastName) shapeFieldsToSync.lastname = lastName;
  if (email) shapeFieldsToSync.email = email;

  const shapeSync = await updateShapeLeadFields(shapeLeadId, shapeFieldsToSync);

  let dispositionEmail = null;
  if (lo?.email) {
    dispositionEmail = buildDispositionEmail({
      leadId: shapeLeadId,
      firstName,
      lastName,
      leadPhone: phoneDigits,
      lo,
      callTime: zoom.timestamp,
      baseUrl: body.disposition_base_url ?? process.env.DISPOSITION_BASE_URL,
    });
  }

  return {
    success: true,
    pipeline: 'full',
    contact_found: contactFound,
    shape_lead_id: shapeLeadId,
    call_id: zoom.callId,
    formatted_phone: formattedPhone,
    first_name: firstName,
    last_name: lastName,
    full_name: fullName,
    lo: lo
      ? {
          display_name: lo.displayName,
          email: lo.email,
          depursLo: lo.depursLo,
          matched_by: lo.matchedBy,
          extension: lo.extension,
        }
      : null,
    owner_assign: ownerAssign,
    lead_id: lead.lead_id,
    lead_created: leadCreated,
    transcript_id: transcript.transcript_id,
    transcript_created: transcriptCreated,
    shape_sync: shapeSync,
    mailer_matched: mailerMatched ?? null,
    disposition_email: dispositionEmail,
    zoom: {
      callee_name: zoom.calleeName,
      callee_extension: zoom.calleeExtension,
      forwarded_by: zoom.forwardedByName,
    },
  };
}
