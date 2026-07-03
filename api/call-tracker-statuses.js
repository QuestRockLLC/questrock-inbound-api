import { getSupabaseClient } from '../lib/supabase.js';
import { assertInboundSession } from '../lib/request-auth.js';
import { sendJson } from '../lib/http.js';
import { loadStatusDefinitions } from '../lib/status-definitions.js';
import { listLoDispositionOptions } from '../lib/call-tracker/manage-call.js';

/**
 * GET /api/call-tracker-statuses — AI + LO status options for manual overrides.
 */
export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return sendJson(res, 405, { ok: false, error: 'Method not allowed.' });
  }

  try {
    assertInboundSession(req, { requireCallTracker: true });

    const aiStatuses = await loadStatusDefinitions(getSupabaseClient());

    return sendJson(res, 200, {
      ok: true,
      ai_statuses: aiStatuses,
      lo_dispositions: listLoDispositionOptions(),
    });
  } catch (error) {
    const statusCode = error.statusCode ?? 500;
    return sendJson(res, statusCode, {
      ok: false,
      error: statusCode === 500 ? 'Internal Server Error' : error.message,
    });
  }
}
