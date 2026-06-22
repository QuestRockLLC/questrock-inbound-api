import { getSupabaseClient } from '../lib/supabase.js';
import { assertInboundSession } from '../lib/request-auth.js';
import { sendJson } from '../lib/http.js';
import { listInboundCalls } from '../lib/call-tracker/list-calls.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return sendJson(res, 405, { ok: false, error: 'Method not allowed.' });
  }

  try {
    assertInboundSession(req, { requireCallTracker: true });

    const state = String(req.query?.state ?? '').trim().toUpperCase() || null;
    const hours = Number(req.query?.hours ?? 24);
    const limit = Number(req.query?.limit ?? 80);

    const allowedChannels = new Set(['questmail', 'inbound_zoom', 'shape_inbound']);
    const channelParam = String(req.query?.channel ?? '').trim().toLowerCase() || null;

    const result = await listInboundCalls(getSupabaseClient(), {
      channel: allowedChannels.has(channelParam) ? channelParam : null,
      state: state && state.length === 2 ? state : null,
      hours: Number.isFinite(hours) ? hours : 24,
      limit: Number.isFinite(limit) ? limit : 80,
    });

    return sendJson(res, 200, { ok: true, ...result });
  } catch (error) {
    const statusCode = error.statusCode ?? 500;
    const message = statusCode === 500 ? 'Internal Server Error' : error.message ?? 'Request failed';
    return sendJson(res, statusCode, { ok: false, error: message });
  }
}
