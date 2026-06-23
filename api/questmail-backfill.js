import { getSupabaseClient } from '../lib/supabase.js';
import { assertInboundSession } from '../lib/request-auth.js';
import { readJsonBody, sendJson } from '../lib/http.js';
import { runQuestMailBackfill } from '../lib/call-tracker/questmail-backfill.js';

/**
 * POST /api/questmail-backfill — repair toll-free collisions and re-run QuestMail AI.
 * Body: { dry_run?, repair_phones?, split_leads?, reprocess?, reprocess_limit?, call_ids?, transcripts? }
 */
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return sendJson(res, 405, { ok: false, error: 'Method not allowed.' });
  }

  try {
    assertInboundSession(req, { requireCallTracker: true });

    const body = readJsonBody(req);
    const report = await runQuestMailBackfill(getSupabaseClient(), {
      dryRun: Boolean(body?.dry_run),
      repairPhones: body?.repair_phones !== false,
      splitLeads: body?.split_leads !== false,
      reprocess: body?.reprocess !== false,
      reprocessLimit: Number(body?.reprocess_limit ?? 100),
      callIds: Array.isArray(body?.call_ids) ? body.call_ids.map(String) : null,
      transcripts: Array.isArray(body?.transcripts) ? body.transcripts : null,
    });

    return sendJson(res, 200, { ok: true, ...report });
  } catch (error) {
    console.error('[questmail-backfill] failed:', error);
    const statusCode = error.statusCode ?? 500;
    return sendJson(res, statusCode, {
      ok: false,
      error: error.message ?? 'Backfill failed',
    });
  }
}

export const config = {
  maxDuration: 300,
};
