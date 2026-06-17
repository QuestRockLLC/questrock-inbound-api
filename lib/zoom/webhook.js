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

/**
 * Zoom endpoint URL validation (required when registering webhook in Zoom app).
 * https://developers.zoom.us/docs/api/rest/webhook-reference/#validate-your-webhook-endpoint
 */
export function handleZoomWebhookChallenge(body) {
  if (body?.event !== 'endpoint.url_validation') {
    return null;
  }

  const plainToken = body?.payload?.plainToken;
  if (!plainToken) {
    return null;
  }

  const secrets = getZoomWebhookSecrets();
  if (!secrets.length) {
    console.warn('[zoom-webhook] url_validation received but ZOOM_WEBHOOK_SECRET is not set');
    return { plainToken, encryptedToken: plainToken };
  }

  const secret = secrets[0];
  const encryptedToken = crypto.createHmac('sha256', secret).update(plainToken).digest('hex');
  return { plainToken, encryptedToken };
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
