import { formatPhoneNumber } from './phone.js';
import { findLeadByPhone } from './leads.js';
import { findTranscriptByExternalCallId } from './transcripts.js';
import { searchShapeLeadByPhone } from './shape/search-lead-by-phone.js';
import { upsertLeadFromShapeCall } from './leads.js';
import { splitFullName } from './name.js';

function isQuestMailPendingLead(lead, answeredMeta) {
  if (!lead || lead.shape_lead_id) {
    return false;
  }
  if (answeredMeta?.questmail_hold || answeredMeta?.pending_disposition) {
    return true;
  }
  return lead.lead_source === 'questmail' && answeredMeta?.call_channel === 'questmail';
}

/**
 * Links a Zoom call_id or borrower phone to an existing Supabase lead + Shape id.
 * Handles transcript arriving before call-answered (uncommon) via phone fallback.
 */
export async function resolveLeadContextForCall(supabase, { callId, callerPhone, direction = 'inbound' }) {
  if (callId) {
    const answered = await findTranscriptByExternalCallId(supabase, `${callId}:answered`);
    if (answered?.lead_id) {
      const { data: lead, error } = await supabase
        .from('leads')
        .select('*')
        .eq('lead_id', answered.lead_id)
        .maybeSingle();

      if (!error && lead) {
        const meta = answered.fields_populated ?? {};
        if (isQuestMailPendingLead(lead, meta)) {
          return {
            lead,
            shapeLeadId: null,
            resolvedBy: 'questmail_pending',
            questmailPending: true,
            callChannel: meta.call_channel ?? 'questmail',
          };
        }
        if (lead.shape_lead_id) {
          return { lead, shapeLeadId: lead.shape_lead_id, resolvedBy: 'call_id' };
        }
      }
    }
  }

  const phoneRaw = callerPhone;
  const formattedPhone = phoneRaw ? formatPhoneNumber(phoneRaw) : null;
  if (formattedPhone) {
    const byPhone = await findLeadByPhone(supabase, formattedPhone);
    if (byPhone?.shape_lead_id) {
      return { lead: byPhone, shapeLeadId: byPhone.shape_lead_id, resolvedBy: 'phone' };
    }

    const search = await searchShapeLeadByPhone(phoneRaw);
    if (search.found && search.leadId) {
      const fullName = [search.firstName, search.lastName].filter(Boolean).join(' ') || 'Unknown Caller';
      const { lead } = await upsertLeadFromShapeCall(supabase, {
        shapeLeadId: search.leadId,
        fullName,
        phoneNumber: formattedPhone,
        email: search.email || null,
      });
      return { lead, shapeLeadId: search.leadId, resolvedBy: 'shape_phone_search' };
    }
  }

  return null;
}

export function parseRecordingFromZoomBody(body) {
  const payloadObject = body.payload?.object ?? {};
  const recordings = payloadObject.recordings ?? [];
  const recording = recordings[0] ?? payloadObject.recording ?? {};

  const callId = String(
    recording.call_id ?? recording.callId ?? payloadObject.call_id ?? body.call_id ?? '',
  ).trim();

  const direction = String(recording.direction ?? body.direction ?? 'inbound').toLowerCase();
  const callerPhone = recording.caller_number ?? recording.callerNumber ?? body.caller_phone;
  const calleePhone = recording.callee_number ?? recording.calleeNumber ?? body.callee_phone;
  const borrowerPhone = direction === 'outbound' ? calleePhone : callerPhone;

  const callerName = recording.caller_name ?? recording.callerName ?? body.caller_name ?? '';
  const split = splitFullName(callerName);

  return {
    callId,
    recording,
    direction,
    callerPhone,
    calleePhone,
    borrowerPhone,
    callerName,
    firstName: split.firstName,
    lastName: split.lastName,
    timestamp: recording.date_time ?? recording.dateTime ?? body.timestamp ?? new Date().toISOString(),
    transcriptDownloadUrl: recording.transcript_download_url ?? recording.transcriptDownloadUrl ?? null,
  };
}
