/**
 * Zapier Catch Hooks expose URL query params as "querystring" fields in the Zap editor.
 * Always POST JSON body AND mirror flat fields onto the hook URL so mapping works either way.
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

/**
 * @param {object} [options]
 * @param {string[]} [options.excludeFromQuery] — still in JSON body; omitted from URL (long HTML, etc.)
 */
export async function postJsonToZapier(webhookUrl, payload, options = {}) {
  const exclude = new Set(options.excludeFromQuery ?? []);
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
