import { getSupabaseClient } from '../../lib/supabase.js';
import { assertLoDeskAuthorized } from '../../lib/mailer-lo/auth.js';
import { getActiveMailerCampaign } from '../../lib/mailer-lo/campaigns.js';
import { sendJson } from '../../lib/http.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return sendJson(res, 405, { ok: false, error: 'Method not allowed.' });
  }

  try {
    assertLoDeskAuthorized(req, {
      import_secret: req.query?.import_secret ?? req.query?.importSecret,
    });

    const campaign = await getActiveMailerCampaign(getSupabaseClient());

    return sendJson(res, 200, { ok: true, campaign });
  } catch (error) {
    return sendJson(res, error.statusCode || 500, {
      ok: false,
      error: error.message || 'Failed to load campaign.',
      auth_hint: error.authHint,
    });
  }
}
