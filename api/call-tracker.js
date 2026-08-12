import { getSupabaseClient } from '../lib/supabase.js';
import { assertInboundSession } from '../lib/request-auth.js';
import { sendJson } from '../lib/http.js';
import { listInboundCalls, searchInboundCalls } from '../lib/call-tracker/list-calls.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return sendJson(res, 405, { ok: false, error: 'Method not allowed.' });
  }

  try {
    const session = assertInboundSession(req, { requireCallTracker: true });

    const state = String(req.query?.state ?? '').trim().toUpperCase() || null;
    const hours = Number(req.query?.hours ?? 24);
    const limit = Number(req.query?.limit ?? 80);
    const searchQuery = String(req.query?.q ?? '').trim();

    const allowedChannels = new Set(['questmail', 'inbound_zoom', 'shape_inbound']);
    const channelParam = String(req.query?.channel ?? '').trim().toLowerCase() || null;

    const listOptions = {
      channel: allowedChannels.has(channelParam) ? channelParam : null,
      state: state && state.length === 2 ? state : null,
      limit: Number.isFinite(limit) ? limit : 80,
      includeArchived: req.query?.include_archived === '1',
      archivedOnly: req.query?.archived_only === '1',
      viewerEmail: session.email,
    };

    const result =
      searchQuery.length >= 2
        ? await searchInboundCalls(getSupabaseClient(), { ...listOptions, q: searchQuery })
        : await listInboundCalls(getSupabaseClient(), {
            ...listOptions,
            hours: Number.isFinite(hours) ? hours : 24,
          });

    return sendJson(res, 200, { ok: true, ...result });
  } catch (error) {
    const statusCode = error.statusCode ?? 500;
    const message = statusCode === 500 ? 'Internal Server Error' : error.message ?? 'Request failed';
    return sendJson(res, statusCode, { ok: false, error: message });
  }
}
