import { getSupabaseClient } from '../lib/supabase.js';
import { assertInboundSession } from '../lib/request-auth.js';
import { sendJson } from '../lib/http.js';
import { analyzeQuestMailRecords } from '../lib/call-tracker/questmail-analytics.js';

/**
 * GET /api/questmail-analytics — ops deep dive on QuestMail leads + transcripts.
 */
export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return sendJson(res, 405, { ok: false, error: 'Method not allowed.' });
  }

  try {
    assertInboundSession(req, { requireCallTracker: true });
    const report = await analyzeQuestMailRecords(getSupabaseClient());
    return sendJson(res, 200, { ok: true, ...report });
  } catch (error) {
    const statusCode = error.statusCode ?? 500;
    return sendJson(res, statusCode, {
      ok: false,
      error: statusCode === 500 ? 'Internal Server Error' : error.message ?? 'Request failed',
    });
  }
}
