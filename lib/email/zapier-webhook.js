/**
 * Zapier Catch Hook delivery — flat fields for Webhook → Outlook (one Zap, two email types).
 *
 * Sends JSON body (all fields including email_html) AND mirrors scalars on the hook URL
 * query string so Zapier mapping works whether you pick root fields or querystring.* .
 */

export function appendPayloadToQuery(urlString, payload) {
  const u = new URL(urlString);
  for (const [key, value] of Object.entries(payload)) {
    if (value === undefined || value === null) {
      continue;
    }
    const serialized =
      typeof value === 'boolean'
        ? value
          ? 'true'
          : 'false'
        : typeof value === 'object'
          ? JSON.stringify(value)
          : String(value);
    u.searchParams.set(key, serialized);
  }
  return u.toString();
}

const QUERY_EXCLUDE = new Set(['email_html', 'email_body']);

/**
 * POST flat fields to a Zapier Catch Hook.
 * @param {object} [options]
 * @param {string[]} [options.excludeFromQuery]
 */
export async function postToZapierCatchHook(webhookUrl, payload, options = {}) {
  const exclude = new Set([...QUERY_EXCLUDE, ...(options.excludeFromQuery ?? [])]);
  const forQuery = { ...payload };
  for (const key of exclude) {
    delete forQuery[key];
  }

  const urlWithQuery = appendPayloadToQuery(webhookUrl, forQuery);

  return fetch(urlWithQuery, {
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
