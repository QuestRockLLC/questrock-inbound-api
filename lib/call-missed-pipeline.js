import { formatPhoneNumber, normalizePhoneDigits, isTollFreePhone } from './phone.js';
import { unwrapZoomBody } from './zoom-payload.js';
import { splitFullName } from './name.js';
import { searchShapeLeadByPhone } from './shape/search-lead-by-phone.js';
import { assignShapeLeadOwner, createShapeInboundLead, updateShapeLeadFields } from './shape/client.js';
import { resolveInboundLo } from './shape/inbound-lo-roster.js';
import { upsertLeadFromShapeCall, createPendingCallLead } from './leads.js';
import { findTranscriptByExternalCallId, insertMissedCallTranscript } from './transcripts.js';
import { resolveInboundCallChannel } from './mailer/resolve-channel.js';

export function isZoomCallMissedPayload(body) {
  if (!body || typeof body !== 'object') return false;
  const event = String(body.event ?? '').toLowerCase();
  return event === 'phone.callee_missed';
}

export function parseZoomCallMissed(body) {
  const zoom = unwrapZoomBody(body);
  const payloadObject = body.payload?.object ?? {};

  const caller = payloadObject.caller ?? {};
  const callee = payloadObject.callee ?? {};
  const owner = payloadObject.owner ?? {};
  const acceptedBy = payloadObject.accepted_by ?? payloadObject.acceptedBy ?? {};

  const callerPhone = zoom.callerPhone ?? caller.phone_number ?? body.caller_phone;
  const calleeName =
    zoom.calleeName ?? callee.name ?? owner.name ?? body.callee_name ?? body.accepted_by_name;
  const calleeExtension = String(
    callee.extension_number ??
      callee.extensionNumber ??
      owner.extension_number ??
      owner.extensionNumber ??
      body.callee_extension ??
      '',
  ).replace(/\D/g, '');

  const timestamp =
    payloadObject.ringing_start_time ??
    payloadObject.ringingStartTime ??
    payloadObject.date_time ??
    zoom.timestamp ??
    new Date().toISOString();

  const callId =
    zoom.callId ??
    payloadObject.call_id ??
    payloadObject.callId ??
    body.call_id ??
    `missed-${Date.now()}-${normalizePhoneDigits(callerPhone) || 'unknown'}`;

  const callerName = zoom.callerName ?? body.caller_name ?? '';
  const split = splitFullName(callerName);

  const missReason =
    payloadObject.handup_result ??
    payloadObject.handupResult ??
    payloadObject.hangup_result ??
    payloadObject.hangupResult ??
    body.handup_result ??
    body.miss_reason ??
    'no_answer';

  return {
    event: 'phone.callee_missed',
    callId: String(callId),
    callerPhone,
    callerName,
    callerFirstName: split.firstName,
    callerLastName: split.lastName,
    calleeName,
    calleeExtension,
    calleePhone: zoom.calleePhone ?? callee.phone_number ?? null,
    acceptedByName: acceptedBy.name ?? body.accepted_by_name ?? null,
    acceptedByExtension: acceptedBy.extension_number
      ? String(acceptedBy.extension_number).replace(/\D/g, '')
      : '',
    timestamp: new Date(timestamp).toISOString(),
    missReason: String(missReason),
    forwardedByName: payloadObject.forwarded_by?.name ?? body.forwarded_by_name ?? null,
    ownerType: owner.type ?? payloadObject.callee_extension_type ?? null,
  };
}

/**
 * Ingest an unanswered inbound Zoom Phone call into Call Tracker.
 */
export async function runCallMissedPipeline(supabase, body) {
  const zoom = parseZoomCallMissed(body);

  const answeredExisting = await findTranscriptByExternalCallId(supabase, `${zoom.callId}:answered`);
  if (answeredExisting) {
    return {
      success: true,
      skipped: true,
      reason: 'call_already_answered',
      call_id: zoom.callId,
    };
  }

  const missedExisting = await findTranscriptByExternalCallId(supabase, `${zoom.callId}:missed`);
  if (missedExisting) {
    return {
      success: true,
      skipped: true,
      reason: 'duplicate_missed_call',
      call_id: zoom.callId,
      transcript_id: missedExisting.transcript_id,
    };
  }

  const formattedPhone = formatPhoneNumber(zoom.callerPhone);
  const phoneDigits = normalizePhoneDigits(zoom.callerPhone);
  const channelInfo = resolveInboundCallChannel(zoom, body);
  const isQuestMail = channelInfo.channel === 'questmail';

  if (!isQuestMail && (!formattedPhone || phoneDigits.length !== 10)) {
    const error = new Error('Borrower phone must contain at least 10 digits for missed call ingest.');
    error.statusCode = 400;
    throw error;
  }

  let shapeLeadId = null;
  let firstName = zoom.callerFirstName || 'WIRELESS';
  let lastName = zoom.callerLastName || 'CALLER';
  let email = '';
  let questmailDeferred = isQuestMail && isTollFreePhone(zoom.callerPhone);

  if (!questmailDeferred) {
    const search = await searchShapeLeadByPhone(zoom.callerPhone);
    if (search.found && search.leadId) {
      shapeLeadId = search.leadId;
      firstName = search.firstName || firstName;
      lastName = search.lastName || lastName;
      email = search.email || '';
    } else if (phoneDigits.length === 10) {
      const created = await createShapeInboundLead({
        firstname: firstName,
        lastname: lastName,
        phone: phoneDigits,
      });
      if (created.created && created.shape_lead_id) {
        shapeLeadId = created.shape_lead_id;
      }
    }
  }

  const lo = resolveInboundLo({
    calleeName: zoom.calleeName,
    calleeExtension: zoom.acceptedByExtension || zoom.calleeExtension,
    calleePhone: zoom.calleePhone,
    acceptedByName: zoom.acceptedByName ?? zoom.forwardedByName,
  });

  if (shapeLeadId && lo?.depursLo) {
    await assignShapeLeadOwner(shapeLeadId, lo.depursLo);
  }

  const fullName = [firstName, lastName].filter(Boolean).join(' ').trim() || 'Unknown Caller';

  let lead;
  let leadCreated;

  if (questmailDeferred) {
    const pending = await createPendingCallLead(supabase, {
      fullName,
      phoneNumber: zoom.callerPhone,
      email: email || null,
      leadSource: 'questmail',
    });
    lead = pending.lead;
    leadCreated = pending.created;
  } else {
    const upserted = await upsertLeadFromShapeCall(supabase, {
      shapeLeadId,
      fullName,
      phoneNumber: formattedPhone,
      email: email || null,
      leadSource: isQuestMail ? 'questmail' : 'inbound_zoom',
    });
    lead = upserted.lead;
    leadCreated = upserted.created;
  }

  const { transcript, created } = await insertMissedCallTranscript(supabase, {
    lead,
    externalCallId: zoom.callId,
    timestamp: zoom.timestamp,
    callSource: isQuestMail ? 'QuestMail' : 'Zoom Phone',
    callMeta: {
      event: 'call_missed',
      call_outcome: 'missed',
      call_id: zoom.callId,
      miss_reason: zoom.missReason,
      call_channel: channelInfo.channel,
      shape_marketing_source: channelInfo.shapeSourceId,
      questmail_state: channelInfo.questmail?.state ?? null,
      questmail_label: channelInfo.questmail?.label ?? null,
      questmail_type: channelInfo.questmail?.mailerType ?? null,
      questmail_toll: channelInfo.questmail?.phone10 ?? null,
      landing_page_state: channelInfo.landing?.state ?? null,
      landing_page_label: channelInfo.landing?.label ?? null,
      utm_campaign: channelInfo.utmCampaign ?? null,
      dialed_number: channelInfo.dialedNumber ?? zoom.calleePhone ?? null,
      lo_name: lo?.displayName ?? null,
      lo_email: lo?.email ?? null,
      lo_extension: lo?.extension ?? zoom.calleeExtension ?? null,
      depurs_lo: lo?.depursLo ?? null,
      disposition_id: lo?.dispositionId ?? null,
      callee_extension_type: zoom.ownerType,
      caller_is_toll_free: isTollFreePhone(zoom.callerPhone),
      questmail_hold: questmailDeferred,
    },
  });

  let shapeSync = { skipped: true, reason: 'No shape lead' };
  if (shapeLeadId && formattedPhone) {
    shapeSync = await updateShapeLeadFields(shapeLeadId, {
      phone: formattedPhone,
      ...(firstName ? { firstname: firstName } : {}),
      ...(lastName ? { lastname: lastName } : {}),
      ...(email ? { email } : {}),
    });
  }

  return {
    success: true,
    pipeline: 'missed',
    call_outcome: 'missed',
    miss_reason: zoom.missReason,
    call_channel: channelInfo.channel,
    shape_lead_id: shapeLeadId,
    call_id: zoom.callId,
    formatted_phone: formattedPhone,
    full_name: fullName,
    lo: lo
      ? {
          display_name: lo.displayName,
          email: lo.email,
          extension: lo.extension,
        }
      : null,
    lead_id: lead.lead_id,
    lead_created: leadCreated,
    transcript_id: transcript.transcript_id,
    transcript_created: created,
    shape_sync: shapeSync,
  };
}
