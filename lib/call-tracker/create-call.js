import { findTranscriptByExternalCallId } from '../transcripts.js';
import { runCallAnsweredPipeline } from '../call-answered-pipeline.js';
import { splitFullName } from '../name.js';
import { normalizePhoneDigits } from '../phone.js';
import {
  buildCallAnsweredPayloadFromCallLog,
  fetchZoomCallLogSummary,
} from '../zoom/fetch-recording-by-call-id.js';
import { sendLoDispositionEmail } from '../disposition/send-lo-email.js';
import { refetchCallTranscript } from './refetch-transcript.js';
import { getInboundLoRoster } from '../shape/inbound-lo-roster.js';

const LANDING_LABELS = {
  FL: 'FL Landing Page',
  GA: 'GA Landing Page',
  NC: 'NC Landing Page',
  SC: 'SC Landing Page',
  TN: 'TN Landing Page',
  TX: 'TX Landing Page',
};

function buildManualCallAnsweredPayload(input) {
  const phoneDigits = normalizePhoneDigits(input.caller_phone ?? input.phone);
  const callId =
    String(input.call_id ?? input.zoom_call_id ?? '').trim() ||
    `manual-${Date.now()}-${phoneDigits.slice(-10) || 'unknown'}`;
  const callerName = String(input.caller_name ?? input.borrower_name ?? '').trim() || 'Unknown Caller';
  const loName = String(input.lo_name ?? input.accepted_by_name ?? '').trim();
  const loExtension = String(input.lo_extension ?? input.callee_extension ?? '').replace(/\D/g, '');

  const object = {
    call_id: callId,
    direction: 'inbound',
    answer_start_time: input.timestamp ?? input.answered_at ?? new Date().toISOString(),
    caller: {
      phone_number: input.caller_phone ?? input.phone,
      name: callerName,
    },
    callee: {
      name: input.callee_name ?? input.queue_name ?? 'Inbound Queue',
      extension_number: input.callee_extension ?? loExtension,
    },
  };

  if (loName) {
    object.accepted_by = {
      name: loName,
      extension_number: loExtension || undefined,
    };
  }

  return {
    event: 'phone.callee_answered',
    pipeline: 'full',
    payload: { object },
    call_tracker_import: true,
    manual: true,
  };
}

async function patchLandingMeta(supabase, transcriptId, landingState) {
  const state = String(landingState ?? '').trim().toUpperCase();
  if (!state || !transcriptId) return;

  const { data: row } = await supabase
    .from('transcripts')
    .select('fields_populated')
    .eq('transcript_id', transcriptId)
    .maybeSingle();

  const meta = row?.fields_populated ?? {};
  await supabase
    .from('transcripts')
    .update({
      fields_populated: {
        ...meta,
        landing_page_state: state,
        landing_page_label: LANDING_LABELS[state] ?? `${state} Landing Page`,
        call_tracker_import: true,
      },
    })
    .eq('transcript_id', transcriptId);
}

async function maybeSendDispositionEmail(supabase, result, { sendEmail, forceResend }) {
  if (!sendEmail || result.skipped || !result.shape_lead_id) {
    return { sent: false, skipped: true, reason: 'Disposition email not requested or call skipped.' };
  }

  if (result.pending_disposition) {
    return {
      sent: false,
      skipped: true,
      reason: 'Disposition email deferred until QuestRock AI runs (pending_disposition).',
    };
  }

  const split = splitFullName(result.full_name);
  let lo = result.lo?.email
    ? {
        email: result.lo.email,
        displayName: result.lo.display_name,
        dispositionId: result.lo.dispositionId ?? 'lo',
      }
    : null;

  if (!lo && result.lo?.display_name) {
    const roster = getInboundLoRoster();
    const match = roster.find((row) =>
      row.names.some((n) => n.toLowerCase() === String(result.lo.display_name).toLowerCase()),
    );
    if (match) {
      lo = { email: match.email, displayName: match.names[0], dispositionId: match.dispositionId };
    }
  }

  if (!lo?.email) {
    return { sent: false, skipped: true, reason: 'LO email not resolved for this call.' };
  }

  return sendLoDispositionEmail(supabase, {
    callId: result.call_id,
    shapeLeadId: String(result.shape_lead_id),
    firstName: result.first_name || split.firstName,
    lastName: result.last_name || split.lastName,
    leadPhone: result.formatted_phone,
    lo,
    callTime: result.timestamp,
    aiStatusLabel: null,
    forceResend,
  });
}

/**
 * Create a Call Tracker row by importing from Zoom or manual fields.
 */
export async function createCallFromCallTracker(
  supabase,
  {
    zoom_call_id,
    call_id,
    caller_name,
    caller_phone,
    borrower_name,
    lo_name,
    lo_extension,
    callee_name,
    callee_extension,
    queue_name,
    landing_state,
    timestamp,
    fetch_transcript = true,
    send_disposition_email = false,
    force = false,
  } = {},
) {
  const zoomId = String(zoom_call_id ?? call_id ?? '').trim();
  let body;

  if (zoomId && !caller_phone && !caller_name && !borrower_name) {
    const existing = await findTranscriptByExternalCallId(supabase, `${zoomId}:answered`);
    if (existing && !force) {
      return {
        ok: true,
        skipped: true,
        reason: 'Call already in Call Tracker',
        call_id: zoomId,
        transcript_id: existing.transcript_id,
      };
    }

    const zoomLog = await fetchZoomCallLogSummary(zoomId);
    if (!zoomLog.ok) {
      const error = new Error(zoomLog.message || 'Could not load call from Zoom');
      error.statusCode = zoomLog.reason === 'call_not_found' ? 404 : 502;
      error.details = { reason: zoomLog.reason, attempts: zoomLog.attempts };
      throw error;
    }

    body = buildCallAnsweredPayloadFromCallLog(zoomLog.log);
  } else {
    if (!caller_phone && !borrower_name) {
      const error = new Error('caller_phone or zoom_call_id is required');
      error.statusCode = 400;
      throw error;
    }

    const manualCallId = zoomId || undefined;
    if (manualCallId) {
      const existing = await findTranscriptByExternalCallId(supabase, `${manualCallId}:answered`);
      if (existing && !force) {
        return {
          ok: true,
          skipped: true,
          reason: 'Call already in Call Tracker',
          call_id: manualCallId,
          transcript_id: existing.transcript_id,
        };
      }
    }

    body = buildManualCallAnsweredPayload({
      call_id: manualCallId,
      caller_phone,
      caller_name: caller_name ?? borrower_name,
      lo_name,
      lo_extension,
      callee_name,
      callee_extension,
      queue_name,
      timestamp,
    });
  }

  const result = await runCallAnsweredPipeline(supabase, body);

  if (landing_state && result.transcript_id) {
    await patchLandingMeta(supabase, result.transcript_id, landing_state);
  }

  let transcriptFetch = { skipped: true };
  if (fetch_transcript && result.call_id) {
    try {
      transcriptFetch = await refetchCallTranscript(supabase, result.call_id);
    } catch (error) {
      transcriptFetch = { ok: false, error: error.message };
    }
  }

  const dispositionSend = await maybeSendDispositionEmail(supabase, result, {
    sendEmail: send_disposition_email,
    forceResend: force,
  });

  return {
    ok: true,
    imported: true,
    ...result,
    transcript_fetch: transcriptFetch,
    disposition_send: dispositionSend,
  };
}
