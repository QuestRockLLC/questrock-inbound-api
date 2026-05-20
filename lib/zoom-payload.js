import { formatPhoneNumber, normalizePhoneDigits } from './phone.js';

function dig(obj, path) {
  let current = obj;

  for (const key of path) {
    if (current == null || typeof current !== 'object') {
      return undefined;
    }

    current = current[key];
  }

  return current;
}

/**
 * Unwraps Zapier Catch Hook bodies from Zoom Phone events.
 */
export function unwrapZoomBody(body) {
  if (!body || typeof body !== 'object') {
    return {};
  }

  const payloadObject = body.payload?.object ?? body.payload?.Object ?? {};
  const recording =
    body.payload?.object?.recordings?.[0] ??
    body.payload?.object?.recording ??
    payloadObject.recordings?.[0] ??
    null;

  const caller = payloadObject.caller ?? recording?.caller ?? {};
  const callee = payloadObject.callee ?? recording?.callee ?? {};

  const callerPhone =
    caller.phone_number ??
    caller.phoneNumber ??
    recording?.caller_number ??
    body.caller_phone;

  const calleePhone =
    callee.phone_number ??
    callee.phoneNumber ??
    recording?.callee_number ??
    body.callee_phone;

  const eventTs = payloadObject.event_ts ?? body.event_ts ?? body.eventTs;
  const answerTime =
    payloadObject.answer_start_time ??
    recording?.date_time ??
    payloadObject.date_time ??
    body.answer_start_time;

  const callId =
    body.call_id ??
    body.callId ??
    recording?.call_id ??
    payloadObject.call_id ??
    payloadObject.callId ??
    (eventTs && callerPhone
      ? `answered-${eventTs}-${normalizePhoneDigits(callerPhone)}`
      : eventTs
        ? `answered-${eventTs}`
        : null);

  const transcriptCallId = recording?.call_id ?? body.call_id ?? callId;

  return {
    shapeLeadId:
      body.shape_lead_id ??
      body.shapeLeadId ??
      body.leadId ??
      body.lead_id ??
      body.recordId,
    callId: transcriptCallId ?? callId,
    callerName: caller.name ?? recording?.caller_name ?? body.caller_name,
    callerPhone,
    calleeName: callee.name ?? recording?.callee_name ?? body.callee_name,
    calleePhone,
    direction:
      body.direction ??
      recording?.direction ??
      payloadObject.direction ??
      'inbound',
    timestamp: body.timestamp ?? answerTime ?? recording?.date_time ?? eventTs,
    transcriptText:
      body.transcript_text ??
      body.transcriptText ??
      body.formatted_transcript ??
      body.transcript,
    loName: body.lo_name ?? body.loName ?? body.accepted_by_name ?? callee.name,
    fullName: body.full_name ?? body.fullName ?? body.leadName,
    email: body.email,
    eventTs,
  };
}

/**
 * Merges flat webhook fields with nested Zoom payload fields.
 */
export function normalizePayload(body) {
  const zoom = unwrapZoomBody(body);

  return {
    shapeLeadId: zoom.shapeLeadId,
    callId: zoom.callId,
    callerName: zoom.callerName,
    callerPhone: zoom.callerPhone,
    calleeName: zoom.calleeName,
    calleePhone: zoom.calleePhone,
    direction: zoom.direction,
    timestamp: zoom.timestamp,
    transcriptText: zoom.transcriptText,
    loName: zoom.loName,
    fullName: zoom.fullName,
    email: zoom.email,
    currentAddress: body.current_address ?? body.currentAddress,
    city: body.city,
    state: body.state,
    zipCode: body.zip_code ?? body.zipCode,
    companyName: body.company_name ?? body.companyName,
    eventTs: zoom.eventTs,
  };
}

export function resolveLeadPhone(normalized) {
  const direction = String(normalized.direction ?? 'inbound').trim().toLowerCase();
  const raw = direction === 'outbound' ? normalized.calleePhone : normalized.callerPhone;
  return {
    direction,
    formattedPhone: raw ? formatPhoneNumber(raw) : null,
    phoneDigits: raw ? normalizePhoneDigits(raw) : null,
  };
}
