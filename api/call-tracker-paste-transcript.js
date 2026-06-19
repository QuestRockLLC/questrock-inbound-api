import { getSupabaseClient } from '../lib/supabase.js';
import { assertInboundSession } from '../lib/request-auth.js';
import { readJsonBody, sendJson } from '../lib/http.js';
import { pasteCallTranscript } from '../lib/call-tracker/paste-transcript.js';

/**
 * POST /api/call-tracker-paste-transcript — save pasted Zoom transcript + optional AI.
 * Body: { call_id, transcript_text, run_ai?: true, force?: false }
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
    const transcriptText = String(body?.transcript_text ?? body?.transcriptText ?? '').trim();
    const runAi = body?.run_ai !== false && body?.runAi !== false;
    const force = body?.force === true || body?.replace === true;

    const result = await pasteCallTranscript(getSupabaseClient(), {
      callId,
      transcriptText,
      runAi,
      force,
    });

    return sendJson(res, 200, result);
  } catch (error) {
    console.error('[call-tracker-paste-transcript] failed:', error);

    const statusCode = error.statusCode ?? 500;
    return sendJson(res, statusCode, {
      ok: false,
      error: error.message ?? 'Request failed',
      details: error.details ?? undefined,
    });
  }
}

export const config = {
  maxDuration: 300,
};
