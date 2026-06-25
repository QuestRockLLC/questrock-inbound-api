import { getSupabaseClient } from '../lib/supabase.js';
import { assertInboundSession } from '../lib/request-auth.js';
import { readJsonBody, sendJson } from '../lib/http.js';
import { syncLoDispositionFromCallTracker } from '../lib/call-tracker/sync-lo-disposition.js';

/**
 * POST /api/call-tracker-sync-disposition
 * Push LO-selected status + note to Shape CRM for a call.
 * Body: { call_id }
 */
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return sendJson(res, 405, { ok: false, error: 'Method not allowed.' });
  }

  try {
    assertInboundSession(req, { requireCallTracker: true });

    const body = readJsonBody(req);
    const callId = String(body?.call_id ?? body?.callId ?? '').trim();

    if (!callId) {
      return sendJson(res, 400, { ok: false, error: 'call_id is required.' });
    }

    const result = await syncLoDispositionFromCallTracker(getSupabaseClient(), callId);
    return sendJson(res, 200, result);
  } catch (error) {
    console.error('[call-tracker-sync-disposition] failed:', error);
    const statusCode = error.statusCode ?? 500;
    return sendJson(res, statusCode, {
      ok: false,
      error: statusCode === 500 ? 'Internal Server Error' : error.message,
    });
  }
}

export const config = {
  maxDuration: 30,
};
