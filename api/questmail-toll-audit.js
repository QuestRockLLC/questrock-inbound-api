import { getSupabaseClient } from '../lib/supabase.js';
import { assertInboundSession } from '../lib/request-auth.js';
import { sendJson } from '../lib/http.js';
import { resolveQuestMailCycle } from '../lib/call-tracker/questmail-cycle.js';
import { auditQuestMailTollLines } from '../lib/call-tracker/questmail-toll-audit.js';

/**
 * GET /api/questmail-toll-audit — toll-free lines seen in transcripts vs tracked calls.
 */
export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return sendJson(res, 405, { ok: false, error: 'Method not allowed.' });
  }

  try {
    assertInboundSession(req, { requireCallTracker: true });
    const cycle = resolveQuestMailCycle(req.query ?? {});
    const audit = await auditQuestMailTollLines(getSupabaseClient(), cycle);
    return sendJson(res, 200, { ok: true, ...audit });
  } catch (error) {
    const statusCode = error.statusCode ?? 500;
    return sendJson(res, statusCode, {
      ok: false,
      error: statusCode === 500 ? 'Internal Server Error' : error.message ?? 'Request failed',
    });
  }
}
