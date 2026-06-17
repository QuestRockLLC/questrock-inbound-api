import crypto from 'node:crypto';

export function getZoomWebhookSecrets() {
  const raw =
    process.env.ZOOM_WEBHOOK_SECRET?.trim() ||
    process.env.ZAPIER_WEBHOOK_SECRET?.trim() ||
    '';
  if (!raw) return [];
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export function getZoomWebhookSecret() {
  return getZoomWebhookSecrets()[0] ?? '';
}

function encryptPlainToken(plainToken, secret) {
  return crypto.createHmac('sha256', secret).update(plainToken).digest('hex');
}

function resolveWebhookSecret(req) {
  const appKey = String(req?.query?.app ?? req?.query?.zoom_app ?? '').trim().toLowerCase();
  if (appKey === 'recording' && process.env.ZOOM_WEBHOOK_SECRET_RECORDING?.trim()) {
    return process.env.ZOOM_WEBHOOK_SECRET_RECORDING.trim();
  }
  if (appKey === 'transcript' && process.env.ZOOM_WEBHOOK_SECRET_TRANSCRIPT?.trim()) {
    return process.env.ZOOM_WEBHOOK_SECRET_TRANSCRIPT.trim();
  }
  if (appKey === 'call' && process.env.ZOOM_WEBHOOK_SECRET_CALL?.trim()) {
    return process.env.ZOOM_WEBHOOK_SECRET_CALL.trim();
  }

  const clientId = req?.headers?.clientid || req?.headers?.clientId;
  const mapRaw = process.env.ZOOM_WEBHOOK_CLIENT_MAP?.trim();
  if (clientId && mapRaw) {
    try {
      const map = JSON.parse(mapRaw);
      if (map[clientId]) return String(map[clientId]).trim();
    } catch {
      /* ignore bad JSON */
    }
  }

  return getZoomWebhookSecrets()[0] ?? '';
}

/**
 * Zoom endpoint URL validation (required when registering webhook in Zoom app).
 * https://developers.zoom.us/docs/api/rest/webhook-reference/#validate-your-webhook-endpoint
 */
export function handleZoomWebhookChallenge(body, req) {
  if (body?.event !== 'endpoint.url_validation') {
    return null;
  }

  const plainToken = body?.payload?.plainToken;
  if (!plainToken) {
    return null;
  }

  const secret = resolveWebhookSecret(req);
  if (!secret) {
    console.warn('[zoom-webhook] url_validation received but ZOOM_WEBHOOK_SECRET is not set');
    return { plainToken, encryptedToken: plainToken };
  }

  return { plainToken, encryptedToken: encryptPlainToken(plainToken, secret) };
}

export function isRecordingCompletedEvent(body) {
  if (!body || typeof body !== 'object') return false;
  if (body.shape_lead_id || body.shapeLeadId) return false;
  if (body.mode === 'legacy') return false;
  const event = String(body.event ?? '').toLowerCase();
  if (
    event === 'recording.completed' ||
    event === 'phone.recording_completed' ||
    event === 'phone.recording_transcript_completed'
  ) {
    return true;
  }
  const recordings = body.payload?.object?.recordings;
  return Array.isArray(recordings) && recordings.length > 0 && Boolean(body.transcript_text) === false;
}
