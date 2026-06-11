import { clearSessionCookieHeader } from '../lib/session.js';
import { sendJson } from '../lib/http.js';

export default async function handler(req, res) {
  if (req.method !== 'POST' && req.method !== 'GET') {
    res.setHeader('Allow', 'GET, POST');
    return sendJson(res, 405, { ok: false, error: 'Method not allowed.' });
  }

  res.setHeader('Set-Cookie', clearSessionCookieHeader());

  if (req.method === 'GET') {
    res.redirect(302, '/login.html');
    return;
  }

  return sendJson(res, 200, { ok: true });
}
