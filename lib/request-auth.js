import { getSessionFromReq } from './session.js';

export function getInboundSession(req) {
  return getSessionFromReq(req);
}

export function assertInboundSession(req, { requireAdmin = false, requireLoDesk = false } = {}) {
  const session = getInboundSession(req);

  if (!session) {
    const error = new Error('Sign in required.');
    error.statusCode = 401;
    throw error;
  }

  if (requireAdmin && !session.isAdmin) {
    const error = new Error('Admin access only.');
    error.statusCode = 403;
    throw error;
  }

  if (requireLoDesk && !session.isAdmin && !session.loName) {
    const error = new Error('Your account is not on the mailer LO roster.');
    error.statusCode = 403;
    throw error;
  }

  return session;
}
