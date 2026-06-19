import { getSupabaseClient } from '../lib/supabase.js';
import { assertInboundSession } from '../lib/request-auth.js';
import { readJsonBody, sendJson } from '../lib/http.js';
import {
  linkCallToMailerLead,
  searchMailerForCallTracker,
} from '../lib/call-tracker/link-mailer.js';

/**
 * GET /api/call-tracker-link-mailer?q=38305
 * POST /api/call-tracker-link-mailer { call_id, mailer_lead_id, run_ai?: true }
 */
export default async function handler(req, res) {
  try {
    assertInboundSession(req, { requireCallTracker: true });
    const supabase = getSupabaseClient();

    if (req.method === 'GET') {
      const q = String(req.query?.q ?? '').trim();
      if (q.length < 2) {
        return sendJson(res, 400, { ok: false, error: 'Search query must be at least 2 characters.' });
      }
      const results = await searchMailerForCallTracker(supabase, q);
      return sendJson(res, 200, { ok: true, count: results.length, results });
    }

    if (req.method !== 'POST') {
      res.setHeader('Allow', 'GET, POST');
      return sendJson(res, 405, { ok: false, error: 'Method not allowed.' });
    }

    const body = readJsonBody(req);
    const callId = String(body?.call_id ?? body?.callId ?? '').trim();
    const mailerLeadId = String(body?.mailer_lead_id ?? body?.mailerLeadId ?? '').trim();
    const runAi = body?.run_ai !== false && body?.runAi !== false;

    const result = await linkCallToMailerLead(supabase, { callId, mailerLeadId, runAi });
    return sendJson(res, 200, result);
  } catch (error) {
    console.error('[call-tracker-link-mailer] failed:', error);
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
