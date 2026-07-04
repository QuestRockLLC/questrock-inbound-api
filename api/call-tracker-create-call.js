import { getSupabaseClient } from '../lib/supabase.js';
import { assertInboundSession } from '../lib/request-auth.js';
import { readJsonBody, sendJson } from '../lib/http.js';
import { createCallFromCallTracker } from '../lib/call-tracker/create-call.js';

/**
 * POST /api/call-tracker-create-call
 * Import a missing Zoom call into Call Tracker (Zoom API or manual fields).
 *
 * Body:
 *   zoom_call_id | call_id — Zoom Phone call ID (preferred)
 *   OR manual: caller_phone, caller_name/borrower_name, lo_name, landing_state, timestamp
 *   fetch_transcript?: boolean (default true)
 *   send_disposition_email?: boolean
 *   force?: boolean — re-import if row exists
 */
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return sendJson(res, 405, { ok: false, error: 'Method not allowed.' });
  }

  try {
    assertInboundSession(req, { requireCallTracker: true });

    const body = readJsonBody(req);
    const result = await createCallFromCallTracker(getSupabaseClient(), {
      zoom_call_id: body.zoom_call_id ?? body.zoomCallId,
      call_id: body.call_id ?? body.callId,
      caller_name: body.caller_name ?? body.callerName,
      caller_phone: body.caller_phone ?? body.callerPhone ?? body.phone,
      borrower_name: body.borrower_name ?? body.borrowerName,
      lo_name: body.lo_name ?? body.loName ?? body.accepted_by_name,
      lo_extension: body.lo_extension ?? body.loExtension,
      callee_name: body.callee_name ?? body.calleeName,
      callee_extension: body.callee_extension ?? body.calleeExtension,
      queue_name: body.queue_name ?? body.queueName,
      landing_state: body.landing_state ?? body.landingState ?? body.state,
      timestamp: body.timestamp ?? body.answered_at,
      fetch_transcript: body.fetch_transcript !== false && body.fetchTranscript !== false,
      send_disposition_email: Boolean(
        body.send_disposition_email ?? body.sendDispositionEmail,
      ),
      force: Boolean(body.force),
    });

    return sendJson(res, 200, result);
  } catch (error) {
    console.error('[call-tracker-create-call] failed:', error);
    const statusCode = error.statusCode ?? 500;
    return sendJson(res, statusCode, {
      ok: false,
      error: statusCode === 500 ? 'Internal Server Error' : error.message,
      details: error.details ?? undefined,
    });
  }
}

export const config = {
  maxDuration: 120,
};
