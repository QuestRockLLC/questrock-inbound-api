let cachedToken = null;
let cachedExpiresAt = 0;

/**
 * Zoom Server-to-Server OAuth (account_credentials).
 * Required to download transcript files from transcript_download_url.
 */
export async function getZoomAccessToken() {
  const accountId = process.env.ZOOM_ACCOUNT_ID?.trim();
  const clientId = process.env.ZOOM_CLIENT_ID?.trim();
  const clientSecret = process.env.ZOOM_CLIENT_SECRET?.trim();

  if (!accountId || !clientId || !clientSecret) {
    return { error: 'Zoom API not configured (ZOOM_ACCOUNT_ID, ZOOM_CLIENT_ID, ZOOM_CLIENT_SECRET)' };
  }

  const now = Date.now();
  if (cachedToken && cachedExpiresAt > now + 60_000) {
    return { accessToken: cachedToken };
  }

  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const url = `https://zoom.us/oauth/token?grant_type=account_credentials&account_id=${encodeURIComponent(accountId)}`;

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
      error: `Zoom OAuth failed (${response.status}): ${json.reason || json.error || 'unknown'}`,
    };
  }

  cachedToken = json.access_token;
  cachedExpiresAt = now + Number(json.expires_in ?? 3600) * 1000;
  return { accessToken: cachedToken };
}
