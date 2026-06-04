import { assertLoDeskAuthorized } from '../../lib/mailer-lo/auth.js';
import { getShapeLoRoster } from '../../shape/lo-roster.js';
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

    return sendJson(res, 200, {
      ok: true,
      roster: getShapeLoRoster(),
    });
  } catch (error) {
    return sendJson(res, error.statusCode || 500, {
      ok: false,
      error: error.message || 'Failed to load LO roster.',
      auth_hint: error.authHint,
    });
  }
}
