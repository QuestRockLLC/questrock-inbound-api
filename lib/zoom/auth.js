/** @type {Map<string, { token: string, expiresAt: number }>} */
const tokenCache = new Map();

/**
 * Collect Server-to-Server OAuth credential sets. Each set must use client id + secret
 * from the same Zoom app (never mix across apps).
 */
export function getZoomOAuthCredentialSets() {
  const accountId = process.env.ZOOM_ACCOUNT_ID?.trim();
  if (!accountId) {
    return [];
  }

  const candidates = [
    {
      label: 'transcript',
      clientId: process.env.ZOOM_CLIENT_ID_TRANSCRIPT?.trim(),
      clientSecret: process.env.ZOOM_CLIENT_SECRET_TRANSCRIPT?.trim(),
    },
    {
      label: 'recording',
      clientId: process.env.ZOOM_CLIENT_ID_RECORDING?.trim(),
      clientSecret: process.env.ZOOM_CLIENT_SECRET_RECORDING?.trim(),
    },
    {
      label: 'default',
      clientId: process.env.ZOOM_CLIENT_ID?.trim(),
      clientSecret: process.env.ZOOM_CLIENT_SECRET?.trim(),
    },
    {
      label: 'call',
      clientId: process.env.ZOOM_CLIENT_ID_CALL?.trim(),
      clientSecret: process.env.ZOOM_CLIENT_SECRET_CALL?.trim(),
    },
  ];

  const seenClientIds = new Set();
  const sets = [];

  for (const candidate of candidates) {
    const { label, clientId, clientSecret } = candidate;
    if (!clientId || !clientSecret) {
      continue;
    }
    if (seenClientIds.has(clientId)) {
      continue;
    }
    seenClientIds.add(clientId);
    sets.push({ label, accountId, clientId, clientSecret });
  }

  return sets;
}

function sortCredentialSets(sets, prefer) {
  const order = ['transcript', 'recording', 'default', 'call'];
  const preferIndex = order.indexOf(prefer);

  return [...sets].sort((a, b) => {
    const ai = order.indexOf(a.label);
    const bi = order.indexOf(b.label);
    const aRank = ai === -1 ? order.length : ai;
    const bRank = bi === -1 ? order.length : bi;

    if (preferIndex !== -1) {
      if (a.label === prefer) return -1;
      if (b.label === prefer) return 1;
    }

    return aRank - bRank;
  });
}

async function fetchTokenForCredentialSet(set, { skipCache = false } = {}) {
  const now = Date.now();
  const cached = tokenCache.get(set.clientId);

  if (!skipCache && cached && cached.expiresAt > now + 60_000) {
    return {
      ok: true,
      accessToken: cached.token,
      label: set.label,
      clientId: set.clientId,
    };
  }

  const basic = Buffer.from(`${set.clientId}:${set.clientSecret}`).toString('base64');
  const url = `https://zoom.us/oauth/token?grant_type=account_credentials&account_id=${encodeURIComponent(set.accountId)}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
  });

  const json = await response.json().catch(() => ({}));
  if (!response.ok || !json.access_token) {
    return {
      ok: false,
      label: set.label,
      clientId: set.clientId,
      error: `Zoom OAuth failed (${response.status}): ${json.reason || json.error || 'unknown'}`,
    };
  }

  tokenCache.set(set.clientId, {
    token: json.access_token,
    expiresAt: now + Number(json.expires_in ?? 3600) * 1000,
  });

  return {
    ok: true,
    accessToken: json.access_token,
    label: set.label,
    clientId: set.clientId,
  };
}

/**
 * Zoom Server-to-Server OAuth (account_credentials).
 * Required to download transcript files from transcript_download_url.
 *
 * @param {{ prefer?: 'transcript' | 'recording' | 'default' | 'call' }} [options]
 */
export async function getZoomAccessToken(options = {}) {
  const prefer = options.prefer ?? 'transcript';
  const sets = sortCredentialSets(getZoomOAuthCredentialSets(), prefer);

  if (!sets.length) {
    return {
      error:
        'Zoom API not configured. Set ZOOM_ACCOUNT_ID plus matching client id/secret from the same app (e.g. ZOOM_CLIENT_ID_TRANSCRIPT + ZOOM_CLIENT_SECRET_TRANSCRIPT).',
    };
  }

  let lastError = null;

  for (const set of sets) {
    const result = await fetchTokenForCredentialSet(set);
    if (result.ok) {
      return {
        accessToken: result.accessToken,
        credentialLabel: result.label,
        clientId: result.clientId,
      };
    }
    lastError = `${result.label} (${result.clientId.slice(-6)}): ${result.error}`;
    console.warn('[zoom-auth] credential set failed:', lastError);
  }

  return {
    error:
      lastError ||
      'All Zoom OAuth credential sets failed. Ensure each client id is paired with its own client secret from the same app.',
  };
}

/**
 * Test each configured credential set (for /api/health diagnostics).
 */
export async function probeZoomOAuth() {
  const sets = getZoomOAuthCredentialSets();

  if (!sets.length) {
    return {
      configured: false,
      account_id_set: Boolean(process.env.ZOOM_ACCOUNT_ID?.trim()),
      results: [],
    };
  }

  const results = [];

  for (const set of sets) {
    const result = await fetchTokenForCredentialSet(set, { skipCache: true });
    results.push({
      label: set.label,
      client_id_suffix: set.clientId.slice(-6),
      ok: result.ok,
      error: result.ok ? null : result.error,
    });
  }

  return {
    configured: true,
    account_id_set: true,
    any_ok: results.some((row) => row.ok),
    results,
  };
}
