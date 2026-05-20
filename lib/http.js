/**
 * Optional webhook auth for Zapier → Vercel calls.
 */
export function assertAuthorized(req) {
  const expectedSecret = process.env.ZAPIER_WEBHOOK_SECRET;

  if (!expectedSecret) {
    return;
  }

  const providedSecret = req.headers['x-zapier-secret'];

  if (providedSecret !== expectedSecret) {
    const error = new Error('Unauthorized webhook request.');
    error.statusCode = 401;
    throw error;
  }
}

export function sendJson(res, statusCode, payload) {
  res.status(statusCode).setHeader('Content-Type', 'application/json').json(payload);
}

export function readJsonBody(req) {
  if (req.body && typeof req.body === 'object') {
    return req.body;
  }

  if (typeof req.body === 'string' && req.body.trim()) {
    return JSON.parse(req.body);
  }

  return req.body ?? {};
}

export { normalizePayload, unwrapZoomBody, resolveLeadPhone } from './zoom-payload.js';
