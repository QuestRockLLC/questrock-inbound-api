/**
 * Optional webhook auth for Zapier → Vercel calls.
 * Zoom native webhooks authenticate via x-zm-signature instead.
 */
export function assertAuthorized(req) {
  if (req.headers['x-zm-signature']) {
    return;
  }

  const secrets = (
    process.env.ZOOM_WEBHOOK_SECRET?.trim() ||
    process.env.ZAPIER_WEBHOOK_SECRET?.trim() ||
    ''
  )
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  if (!secrets.length) {
    return;
  }

  const providedSecret =
    req.headers['x-zoom-secret'] ||
    req.headers['x-zapier-secret'] ||
    req.headers['authorization']?.replace(/^Bearer\s+/i, '');

  if (!providedSecret || !secrets.includes(providedSecret)) {
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
