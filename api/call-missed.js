import { getSupabaseClient } from '../lib/supabase.js';
import { assertAuthorized, readJsonBody, sendJson } from '../lib/http.js';
import { handleZoomWebhookChallenge } from '../lib/zoom/webhook.js';
import { isZoomCallMissedPayload, runCallMissedPipeline } from '../lib/call-missed-pipeline.js';

/**
 * Missed / unanswered inbound — Zoom `phone.callee_missed`.
 */
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return sendJson(res, 405, { error: 'Method Not Allowed' });
  }

  try {
    const body = readJsonBody(req);

    const challenge = handleZoomWebhookChallenge(body, req);
    if (challenge) {
      return sendJson(res, 200, challenge);
    }

    assertAuthorized(req);

    if (!isZoomCallMissedPayload(body)) {
      return sendJson(res, 400, {
        ok: false,
        error: 'Expected phone.callee_missed event.',
        event: body?.event ?? null,
      });
    }

    const result = await runCallMissedPipeline(getSupabaseClient(), body);
    return sendJson(res, 200, { ok: true, ...result });
  } catch (error) {
    console.error('[call-missed] failed:', error);

    const statusCode = error.statusCode ?? 500;
    const message =
      statusCode === 500 ? 'Internal Server Error' : error.message ?? 'Request failed';

    return sendJson(res, statusCode, {
      ok: false,
      error: message,
      details: error.details ?? undefined,
    });
  }
}

export const config = {
  maxDuration: 60,
};
