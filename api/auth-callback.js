import { fetchHubUserFromToken } from '../lib/hub-auth.js';
import { buildInboundUserProfile } from '../lib/inbound-access.js';
import { sessionCookieHeader, signSession } from '../lib/session.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    res.status(405).end('Method Not Allowed');
    return;
  }

  const secret = process.env.AUTH_SESSION_SECRET;
  const accessToken = String(req.query?.sso_at ?? '').trim();
  const nextPath = String(req.query?.next ?? '').trim();

  if (!accessToken) {
    res.redirect(302, '/login.html');
    return;
  }

  if (!secret) {
    res.redirect(302, '/login.html?error=not_configured');
    return;
  }

  const user = await fetchHubUserFromToken(accessToken);
  if (user.error) {
    res.redirect(302, `/login.html?error=${encodeURIComponent(user.error)}`);
    return;
  }

  const profile = buildInboundUserProfile(user.email, user.displayName);
  const token = signSession(secret, profile.email, {
    name: profile.name,
    loName: profile.loName,
    isAdmin: profile.isAdmin,
  });

  res.setHeader('Set-Cookie', sessionCookieHeader(token));

  let destination = profile.defaultPath;
  if (nextPath.startsWith('/') && !nextPath.startsWith('//')) {
    if (nextPath.startsWith('/mailer-import/') && !profile.isAdmin) {
      destination = '/mailer-lo/';
    } else {
      destination = nextPath;
    }
  }

  res.redirect(302, destination);
}
