import { getSupabaseClient } from '../lib/supabase.js';
import { assertInboundSession } from '../lib/request-auth.js';
import { readJsonBody, sendJson } from '../lib/http.js';
import { sendDispositionEmailFromCallTracker } from '../lib/call-tracker/send-disposition-email.js';

/**
 * POST /api/call-tracker-send-disposition-email
 * Send LO disposition email (status buttons) via Zapier → Outlook.
 * Body: { call_id, force?: boolean } — force=true resends even if already sent.
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
    const forceResend = Boolean(body?.force ?? body?.force_resend ?? body?.forceResend);

    if (!callId) {
      return sendJson(res, 400, { ok: false, error: 'call_id is required.' });
    }

    const result = await sendDispositionEmailFromCallTracker(getSupabaseClient(), callId, {
      forceResend,
    });

    return sendJson(res, 200, result);
  } catch (error) {
    console.error('[call-tracker-send-disposition-email] failed:', error);
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
