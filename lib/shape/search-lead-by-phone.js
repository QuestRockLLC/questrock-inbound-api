import { normalizePhoneDigits } from '../phone.js';

const DEFAULT_SEARCH_BASE = 'https://secure-api.setshape.com/api';

function getShapeSearchConfig() {
  const apiKey = process.env.SHAPE_API_KEY || process.env.SHAPE_ACCESS_TOKEN;
  const crmId =
    process.env.SHAPE_CRM_ID || process.env.SHAPE_ACCOUNT_ID || process.env.CRM_ID || '';
  const searchBase = (process.env.SHAPE_BASE_URL || DEFAULT_SEARCH_BASE).replace(/\/+$/, '');
  return { apiKey, crmId: String(crmId).trim(), searchBase };
}

function unwrapSearchResults(json) {
  if (Array.isArray(json) && json.length > 0) {
    return json[0];
  }
  if (Array.isArray(json?.data) && json.data.length > 0) {
    return json.data[0];
  }
  if (json?.data && typeof json.data === 'object' && !Array.isArray(json.data)) {
    return json.data;
  }
  return null;
}

/**
 * Search Shape CRM for a lead by borrower phone (CRM id in URL path, not phone).
 */
export async function searchShapeLeadByPhone(phone) {
  const { apiKey, crmId, searchBase } = getShapeSearchConfig();

  if (!apiKey || !crmId) {
    return {
      found: false,
      error: 'Shape API not configured (SHAPE_API_KEY / SHAPE_CRM_ID)',
    };
  }

  const phone10 = normalizePhoneDigits(phone);
  if (phone10.length !== 10) {
    return { found: false, error: 'Phone must have 10 digits after normalization' };
  }

  const apiUrl = `${searchBase}/search/lead/${encodeURIComponent(crmId)}`;
  const bodyVariants = [{ phone: phone10 }, { phone: `1${phone10}` }];

  let lastError = null;

  for (const body of bodyVariants) {
    let response;
    let text = '';
    try {
      response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          Authorization: apiKey,
        },
        body: JSON.stringify(body),
      });
      text = await response.text();
    } catch (err) {
      lastError = err.message;
      continue;
    }

    let json = {};
    try {
      json = text ? JSON.parse(text) : {};
    } catch {
      return { found: false, error: `Shape search returned non-JSON: ${text.slice(0, 200)}` };
    }

    if (!response.ok) {
      lastError = `HTTP ${response.status}: ${text.slice(0, 200)}`;
      continue;
    }

    const lead = unwrapSearchResults(json);
    if (lead) {
      return {
        found: true,
        leadId: String(lead.id ?? lead.leadid ?? lead.lead_id ?? ''),
        firstName: String(lead.firstname ?? lead.first_name ?? '').trim(),
        lastName: String(lead.lastname ?? lead.last_name ?? '').trim(),
        email: String(lead.email ?? '').trim(),
        phone: String(lead.phone ?? lead.mobilephone ?? phone10).trim(),
        searchBodyUsed: body,
        shapeResponse: json,
      };
    }
  }

  return {
    found: false,
    phone10,
    error: lastError ?? 'no_contact_found',
  };
}
