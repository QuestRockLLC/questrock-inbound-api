import { getSupabaseClient } from '../lib/supabase.js';
import { sendJson } from '../lib/http.js';
import { syncShapeLeadArrivals } from '../lib/shape/lead-sync.js';

function assertCronAuthorized(req) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) {
    const error = new Error('CRON_SECRET is not configured on this deployment.');
    error.statusCode = 503;
    throw error;
  }

  const provided =
    req.headers['x-cron-secret'] ||
    req.headers.authorization?.replace(/^Bearer\s+/i, '').trim();

  if (!provided || provided !== secret) {
    const error = new Error('Unauthorized cron request.');
    error.statusCode = 401;
    throw error;
  }
}

/**
 * GET /api/shape-lead-sync — Vercel cron polls Shape for new leads.
 */
export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return sendJson(res, 405, { ok: false, error: 'Method not allowed.' });
  }

  try {
    assertCronAuthorized(req);
    const result = await syncShapeLeadArrivals(getSupabaseClient());
    return sendJson(res, 200, result);
  } catch (error) {
    console.error('[shape-lead-sync] failed:', error);
    const statusCode = error.statusCode ?? 500;
    return sendJson(res, statusCode, {
      ok: false,
      error: error.message ?? 'Shape lead sync failed.',
    });
  }
}

export const config = {
  maxDuration: 60,
};
