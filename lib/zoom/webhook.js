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

function getRequestQueryParam(req, name) {
  const direct = req?.query?.[name];
  if (direct) return String(direct).trim();

  try {
    const url = req?.url || '';
    const qs = url.includes('?') ? url.split('?')[1].split('#')[0] : '';
    return new URLSearchParams(qs).get(name)?.trim() || '';
  } catch {
    return '';
  }
}

function getRequestPath(req) {
  const url = req?.url || '';
  return url.split('?')[0] || '';
}

function resolveWebhookSecret(req) {
  const appKey =
    getRequestQueryParam(req, 'app') || getRequestQueryParam(req, 'zoom_app');
  if (appKey) {
    const key = appKey.toLowerCase();
    if (key === 'recording' && process.env.ZOOM_WEBHOOK_SECRET_RECORDING?.trim()) {
      return process.env.ZOOM_WEBHOOK_SECRET_RECORDING.trim();
    }
    if (key === 'transcript' && process.env.ZOOM_WEBHOOK_SECRET_TRANSCRIPT?.trim()) {
      return process.env.ZOOM_WEBHOOK_SECRET_TRANSCRIPT.trim();
    }
    if (key === 'call' && process.env.ZOOM_WEBHOOK_SECRET_CALL?.trim()) {
      return process.env.ZOOM_WEBHOOK_SECRET_CALL.trim();
    }
  }

  const clientId = String(req?.headers?.clientid || req?.headers?.clientId || '').trim();
  if (clientId) {
    const clientMap = [
      [process.env.ZOOM_CLIENT_ID, process.env.ZOOM_WEBHOOK_SECRET_TRANSCRIPT],
      [process.env.ZOOM_CLIENT_ID_CALL, process.env.ZOOM_WEBHOOK_SECRET_CALL],
      [process.env.ZOOM_CLIENT_ID_RECORDING, process.env.ZOOM_WEBHOOK_SECRET_RECORDING],
    ];
    for (const [mappedClientId, secret] of clientMap) {
      if (mappedClientId?.trim() && clientId === mappedClientId.trim() && secret?.trim()) {
        return secret.trim();
      }
    }

    const mapRaw = process.env.ZOOM_WEBHOOK_CLIENT_MAP?.trim();
    if (mapRaw) {
      try {
        const map = JSON.parse(mapRaw);
        if (map[clientId]) return String(map[clientId]).trim();
      } catch {
        /* ignore bad JSON */
      }
    }
  }

  const path = getRequestPath(req);
  if (path.includes('/api/call-answered') && process.env.ZOOM_WEBHOOK_SECRET_CALL?.trim()) {
    return process.env.ZOOM_WEBHOOK_SECRET_CALL.trim();
  }
  if (path.includes('/api/zoom-transcript')) {
    if (process.env.ZOOM_WEBHOOK_SECRET_TRANSCRIPT?.trim()) {
      return process.env.ZOOM_WEBHOOK_SECRET_TRANSCRIPT.trim();
    }
    if (process.env.ZOOM_WEBHOOK_SECRET_RECORDING?.trim()) {
      return process.env.ZOOM_WEBHOOK_SECRET_RECORDING.trim();
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
