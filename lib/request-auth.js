import { getSessionFromReq } from './session.js';
import { canAccessCallTracker } from './inbound-access.js';

export function getInboundSession(req) {
  return getSessionFromReq(req);
}

export function assertInboundSession(req, { requireAdmin = false, requireCallTracker = false, requireLoDesk = false } = {}) {
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

  if (requireCallTracker && !canAccessCallTracker(session.email)) {
    const error = new Error('Call Tracker access only.');
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
