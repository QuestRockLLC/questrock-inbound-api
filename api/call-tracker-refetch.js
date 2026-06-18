import { getSupabaseClient } from '../lib/supabase.js';
import { assertInboundSession } from '../lib/request-auth.js';
import { readJsonBody, sendJson } from '../lib/http.js';
import { refetchCallTranscript } from '../lib/call-tracker/refetch-transcript.js';

/**
 * POST /api/call-tracker-refetch — pull transcript from Zoom for a stuck call.
 * Body: { call_id: "7652451507461830788" }
 */
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return sendJson(res, 405, { ok: false, error: 'Method not allowed.' });
  }

  try {
    assertInboundSession(req, { requireCallTracker: true });

    const body = readJsonBody(req);
    const callId = String(body?.call_id ?? body?.callId ?? req.query?.call_id ?? '').trim();

    if (!callId) {
      return sendJson(res, 400, { ok: false, error: 'call_id is required.' });
    }

    const result = await refetchCallTranscript(getSupabaseClient(), callId);
    return sendJson(res, 200, { ok: true, ...result });
  } catch (error) {
    console.error('[call-tracker-refetch] failed:', error);

    const statusCode = error.statusCode ?? 500;
    const message = error.message ?? 'Request failed';

    return sendJson(res, statusCode, {
      ok: false,
      error: message,
      details: error.details ?? undefined,
    });
  }
}

export const config = {
  maxDuration: 300,
};
