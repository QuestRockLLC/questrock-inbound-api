import { getInboundSession } from '../lib/request-auth.js';
import { sendJson } from '../lib/http.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return sendJson(res, 405, { ok: false, error: 'Method not allowed.' });
  }

  const session = getInboundSession(req);
  if (!session) {
    return sendJson(res, 401, { ok: false, error: 'Not signed in.' });
  }

  const email = session.email;
  const name = session.name || email.split('@')[0];

  return sendJson(res, 200, {
    ok: true,
    email,
    name,
    isAdmin: Boolean(session.isAdmin),
    loName: session.loName || '',
    redirectTo: session.isAdmin ? '/mailer-import/' : '/mailer-lo/',
  });
}
