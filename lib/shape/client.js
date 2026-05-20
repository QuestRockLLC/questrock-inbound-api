const DEFAULT_SEARCH_BASE = 'https://secure-api.setshape.com/api';
const DEFAULT_UPDATE_URL = 'https://secure.setshape.com/api/update/lead/info';

function getShapeConfig() {
  const apiKey = process.env.SHAPE_API_KEY || process.env.SHAPE_ACCESS_TOKEN;
  const crmId =
    process.env.SHAPE_CRM_ID || process.env.SHAPE_ACCOUNT_ID || process.env.CRM_ID || '';
  const searchBase = (process.env.SHAPE_BASE_URL || DEFAULT_SEARCH_BASE).replace(/\/+$/, '');
  const updateUrl = (process.env.SHAPE_UPDATE_URL || DEFAULT_UPDATE_URL).trim();

  return { apiKey, crmId, searchBase, updateUrl };
}

function unwrapLead(json) {
  if (!json || typeof json !== 'object') {
    return {};
  }

  if (Array.isArray(json) && json[0]) {
    return json[0];
  }

  if (Array.isArray(json.data) && json.data[0]) {
    return json.data[0];
  }

  if (json.data && typeof json.data === 'object' && !Array.isArray(json.data)) {
    return json.data;
  }

  if (json.lead && typeof json.lead === 'object') {
    return json.lead;
  }

  return json;
}

/**
 * Loads current Shape lead fields for AI context and merge rules.
 */
export async function fetchShapeLead(shapeLeadId) {
  const { apiKey, crmId, searchBase } = getShapeConfig();

  if (!apiKey || !crmId) {
    return { lead: {}, configured: false };
  }

  const lead_id = /^\d+$/.test(String(shapeLeadId)) ? Number(shapeLeadId) : shapeLeadId;

  const response = await fetch(
    `${searchBase}/search/lead/${encodeURIComponent(String(crmId).trim())}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: apiKey,
      },
      body: JSON.stringify({ lead_id }),
    },
  );

  const text = await response.text();
  let json = {};

  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    const error = new Error(`Shape search returned non-JSON: ${text.slice(0, 300)}`);
    error.statusCode = 502;
    throw error;
  }

  if (!response.ok) {
    const error = new Error(`Shape search failed (${response.status})`);
    error.statusCode = 502;
    error.shapeResponse = json;
    throw error;
  }

  return { lead: unwrapLead(json), configured: true };
}

function withSystemId(payload) {
  const crmRaw =
    process.env.SHAPE_CRM_ID || process.env.SHAPE_ACCOUNT_ID || process.env.CRM_ID || '';
  const crmId = String(crmRaw).trim();

  if (!crmId) {
    return payload;
  }

  const numeric = Number(crmId);
  if (Number.isNaN(numeric)) {
    return payload;
  }

  return { ...payload, systemid: numeric };
}

/**
 * Updates Shape lead status (mstrstatus1) and AI-extracted fields.
 */
export async function syncShapeLeadFromEvaluation(shapeLeadId, evaluation) {
  const { apiKey, updateUrl } = getShapeConfig();

  if (!apiKey) {
    return {
      synced: false,
      skipped: true,
      reason: 'Missing SHAPE_API_KEY',
    };
  }

  const leadid = Number(shapeLeadId);
  if (Number.isNaN(leadid)) {
    const error = new Error(`shape_lead_id must be numeric for Shape sync, got: ${shapeLeadId}`);
    error.statusCode = 400;
    throw error;
  }

  const payload = withSystemId({
    leadid,
    mstrstatus1: evaluation.status.status_label,
    ...evaluation.fieldsPopulated,
  });

  const response = await fetch(updateUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      Authorization: apiKey,
    },
    body: JSON.stringify(payload),
  });

  const text = await response.text();
  let shapeResponse = {};

  try {
    shapeResponse = text ? JSON.parse(text) : {};
  } catch {
    shapeResponse = { raw: text.slice(0, 500) };
  }

  const asyncHint = /\b(queued|queue|processing|being processed|pending)\b/i.test(
    JSON.stringify(shapeResponse),
  );

  if (!response.ok) {
    return {
      synced: false,
      skipped: false,
      http_status: response.status,
      shape_response: shapeResponse,
      fields_sent: Object.keys(evaluation.fieldsPopulated),
      status_sent: evaluation.status.status_label,
      error: `Shape update rejected (${response.status})`,
    };
  }

  return {
    synced: true,
    skipped: false,
    http_status: response.status,
    shape_response: shapeResponse,
    shape_async_or_queued_hint: asyncHint,
    fields_sent: Object.keys(evaluation.fieldsPopulated),
    status_sent: evaluation.status.status_label,
    update_url: updateUrl,
  };
}
