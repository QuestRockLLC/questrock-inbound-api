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

function normalizeImportSecret(value) {
  let secret = String(value ?? '').trim();
  if (
    (secret.startsWith('"') && secret.endsWith('"')) ||
    (secret.startsWith("'") && secret.endsWith("'"))
  ) {
    secret = secret.slice(1, -1).trim();
  }
  return secret;
}

export function getMailerImportExpectedSecret() {
  return normalizeImportSecret(process.env.MAILER_IMPORT_SECRET);
}

/**
 * Accepts password from JSON body (preferred), header, Bearer, or query string.
 */
export function extractImportSecret(req, body = null) {
  const fromBody =
    body?.import_secret ?? body?.importSecret ?? body?.mailer_import_secret ?? null;

  if (fromBody != null && String(fromBody).trim() !== '') {
    return { secret: normalizeImportSecret(fromBody), via: 'body' };
  }

  const fromHeader = req.headers?.['x-mailer-import-secret'];
  if (fromHeader) {
    return { secret: normalizeImportSecret(fromHeader), via: 'header' };
  }

  const fromBearer = req.headers?.authorization?.replace(/^Bearer\s+/i, '');
  if (fromBearer) {
    return { secret: normalizeImportSecret(fromBearer), via: 'bearer' };
  }

  const fromQuery = req.query?.import_secret ?? req.query?.importSecret;
  if (fromQuery) {
    return { secret: normalizeImportSecret(fromQuery), via: 'query' };
  }

  return { secret: '', via: 'none' };
}

/**
 * Auth for mailer import UI and API only (not Zapier inbound webhooks).
 * Uses MAILER_IMPORT_SECRET only — does not fall back to ZAPIER_WEBHOOK_SECRET.
 */
export function assertImportAuthorized(req, body = null) {
  const expectedSecret = getMailerImportExpectedSecret();

  if (!expectedSecret) {
    return { configured: false, via: 'none' };
  }

  const { secret: providedSecret, via } = extractImportSecret(req, body);

  if (providedSecret !== expectedSecret) {
    const error = new Error(
      'Unauthorized import request. Password must match MAILER_IMPORT_SECRET in Vercel exactly, then redeploy.',
    );
    error.statusCode = 401;
    error.authHint = {
      mailer_secret_configured: true,
      secret_provided: Boolean(providedSecret),
      provided_via: via,
    };
    throw error;
  }

  return { configured: true, via };
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
