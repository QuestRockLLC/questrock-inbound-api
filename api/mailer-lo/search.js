import { getSupabaseClient } from '../../lib/supabase.js';
import { assertLoDeskAuthorized } from '../../lib/mailer-lo/auth.js';
import { searchMailerLeads } from '../../lib/mailer-lo/search.js';
import { readJsonBody, sendJson } from '../../lib/http.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return sendJson(res, 405, { ok: false, error: 'Method not allowed.' });
  }

  try {
    assertLoDeskAuthorized(req, {
      import_secret: req.query?.import_secret ?? req.query?.importSecret,
    });

    const q = String(req.query?.q ?? '').trim();
    const results = await searchMailerLeads(getSupabaseClient(), q);

    return sendJson(res, 200, { ok: true, query: q, count: results.length, results });
  } catch (error) {
    return sendJson(res, error.statusCode || 500, {
      ok: false,
      error: error.message || 'Search failed.',
      auth_hint: error.authHint,
    });
  }
}
