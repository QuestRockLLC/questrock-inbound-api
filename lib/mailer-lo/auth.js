import { assertInboundSession } from '../request-auth.js';

export function assertLoDeskAuthorized(req) {
  return assertInboundSession(req, { requireLoDesk: true });
}

export function assertLoDeskOrAdmin(req) {
  return assertInboundSession(req);
}
