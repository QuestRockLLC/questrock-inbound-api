import { getSupabaseClient } from '../lib/supabase.js';
import { assertInboundSession } from '../lib/request-auth.js';
import { sendJson } from '../lib/http.js';
import { buildQuestMailReport } from '../lib/call-tracker/questmail-report.js';
import { resolveQuestMailCycle } from '../lib/call-tracker/questmail-cycle.js';

/**
 * GET /api/questmail-report — QuestMail ops summary.
 * Query: kind=monday|friday (default friday), or since/until/cycle_label for custom range.
 */
export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return sendJson(res, 405, { ok: false, error: 'Method not allowed.' });
  }

  try {
    assertInboundSession(req, { requireCallTracker: true });
    const cycle = resolveQuestMailCycle(req.query ?? {});
    const report = await buildQuestMailReport(getSupabaseClient(), cycle);
    return sendJson(res, 200, { ok: true, ...report });
  } catch (error) {
    const statusCode = error.statusCode ?? 500;
    return sendJson(res, statusCode, {
      ok: false,
      error: statusCode === 500 ? 'Internal Server Error' : error.message ?? 'Request failed',
    });
  }
}
