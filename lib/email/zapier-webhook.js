/**
 * Zapier Catch Hook delivery — flat JSON POST (one Zap, two email types).
 *
 * Sends a single application/json body with all fields including email_html.
 * Do not mirror onto the hook URL query string — that causes Zapier to expose
 * only querystring for large LO disposition payloads while smaller admin emails parse fully.
 */

/**
 * POST flat fields to a Zapier Catch Hook.
 */
export async function postToZapierCatchHook(webhookUrl, payload) {
  const url = String(webhookUrl ?? '').trim();
  if (!url) {
    throw new Error('Zapier webhook URL is required');
  }

  return fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      Accept: 'application/json',
    },
    body: JSON.stringify(payload),
  });
}

/** @deprecated use postToZapierCatchHook */
export const postJsonToZapier = postToZapierCatchHook;

/** @deprecated query mirroring removed — kept so old imports do not break */
export function appendPayloadToQuery(urlString, payload) {
  const u = new URL(urlString);
  for (const [key, value] of Object.entries(payload)) {
    if (value === undefined || value === null) {
      continue;
    }
    u.searchParams.set(key, typeof value === 'object' ? JSON.stringify(value) : String(value));
  }
  return u.toString();
}
