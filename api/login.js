import { signInWithPassword } from '../lib/hub-auth.js';
import { buildInboundUserProfile } from '../lib/inbound-access.js';
import { sessionCookieHeader, signSession } from '../lib/session.js';
import { readJsonBody, sendJson } from '../lib/http.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return sendJson(res, 405, { ok: false, error: 'Method not allowed.' });
  }

  const secret = process.env.AUTH_SESSION_SECRET;
  if (!secret) {
    return sendJson(res, 503, { ok: false, error: 'AUTH_SESSION_SECRET not configured.' });
  }

  const body = readJsonBody(req);
  const email = String(body?.email ?? '').toLowerCase().trim();
  const password = String(body?.password ?? '');

  if (!email || !password) {
    return sendJson(res, 400, { ok: false, error: 'Email and password are required.' });
  }

  const auth = await signInWithPassword(email, password);
  if (auth.error) {
    return sendJson(res, 401, { ok: false, error: auth.error });
  }

  const profile = buildInboundUserProfile(auth.email, auth.displayName);
  const token = signSession(secret, profile.email, {
    name: profile.name,
    loName: profile.loName,
    isAdmin: profile.isAdmin,
  });

  res.setHeader('Set-Cookie', sessionCookieHeader(token));
  return sendJson(res, 200, {
    ok: true,
    email: profile.email,
    name: profile.name,
    isAdmin: profile.isAdmin,
    loName: profile.loName,
    redirectTo: profile.defaultPath,
  });
}
