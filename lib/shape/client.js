const DEFAULT_SEARCH_BASE = 'https://secure-api.setshape.com/api';
const DEFAULT_UPDATE_URL = 'https://secure-api.setshape.com/api/update/lead/info';

const TRANSCRIPT_SYNC_DISABLED_REASON =
  'Inbound Zoom transcript Shape sync disabled (set SHAPE_TRANSCRIPT_SYNC_ENABLED=true to enable)';

/**
 * OpenAPI search/update for /api/zoom-transcript and re-evaluate only.
 * Mailer import uses postlead and is not gated by this flag.
 */
export function isShapeTranscriptSyncEnabled() {
  const flag = String(process.env.SHAPE_TRANSCRIPT_SYNC_ENABLED ?? '')
    .trim()
    .toLowerCase();
  return flag === 'true' || flag === '1' || flag === 'yes';
}

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
  if (!isShapeTranscriptSyncEnabled()) {
    return { lead: {}, configured: false, skipped: true, reason: TRANSCRIPT_SYNC_DISABLED_REASON };
  }

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
  if (!isShapeTranscriptSyncEnabled()) {
    return {
      synced: false,
      skipped: true,
      reason: TRANSCRIPT_SYNC_DISABLED_REASON,
    };
  }

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

const DEFAULT_MAIL_POST_LEAD_URL = 'https://secure-api.setshape.com/postlead/20931/21580';

function getShapePostLeadUrl() {
  const direct = (process.env.SHAPE_POST_LEAD_URL || '').trim();
  if (direct) {
    return direct;
  }

  const crmId = String(
    process.env.SHAPE_CRM_ID || process.env.SHAPE_ACCOUNT_ID || process.env.CRM_ID || '20931',
  ).trim();
  const sourceId = String(process.env.SHAPE_MAILER_SOURCE_ID || '21580').trim();

  if (!crmId || !sourceId) {
    return DEFAULT_MAIL_POST_LEAD_URL;
  }

  return `https://secure-api.setshape.com/postlead/${crmId}/${sourceId}`;
}

function extractShapeLeadId(json) {
  if (!json || typeof json !== 'object') {
    return null;
  }

  const candidates = [
    json.lead_id,
    json.leadId,
    json.leadid,
    json.LeadId,
    json.LeadID,
    json['Lead ID'],
    json.data?.lead_id,
    json.data?.leadid,
  ];

  for (const value of candidates) {
    const numeric = Number(value);
    if (!Number.isNaN(numeric) && numeric > 0) {
      return String(numeric);
    }
  }

  const text = JSON.stringify(json);
  const match = text.match(/"lead[_ ]?id"\s*:\s*"?(\d+)"?/i);
  if (match?.[1]) {
    return match[1];
  }

  return null;
}

/**
 * Creates a Shape lead via Marketing Source post URL (HTTP POST).
 */
export async function createShapeLeadViaPost(payload) {
  const postUrl = getShapePostLeadUrl();

  if (!postUrl) {
    return {
      created: false,
      skipped: true,
      reason:
        'Missing SHAPE_POST_LEAD_URL or SHAPE_CRM_ID + SHAPE_MAILER_SOURCE_ID',
    };
  }

  const response = await fetch(postUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
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

  const shapeLeadId = extractShapeLeadId(shapeResponse);

  if (!response.ok) {
    return {
      created: false,
      skipped: false,
      http_status: response.status,
      shape_response: shapeResponse,
      error: `Shape postlead rejected (${response.status})`,
    };
  }

  if (!shapeLeadId) {
    return {
      created: false,
      skipped: false,
      http_status: response.status,
      shape_response: shapeResponse,
      error: 'Shape postlead succeeded but no lead ID was returned',
    };
  }

  return {
    created: true,
    skipped: false,
    http_status: response.status,
    shape_lead_id: shapeLeadId,
    shape_response: shapeResponse,
    post_url: postUrl,
  };
}

/**
 * Assigns lead owner in Shape (same API as inbound call-answered Zap).
 * POST /api/assign/lead/owner/{leadId} with lead_owner_id — NOT depursLo on update/lead/info.
 */
export async function assignShapeLeadOwner(shapeLeadId, leadOwnerId) {
  const { apiKey, searchBase } = getShapeConfig();

  if (!apiKey) {
    return {
      synced: false,
      skipped: true,
      reason: 'Missing SHAPE_API_KEY',
    };
  }

  const leadId = Number(shapeLeadId);
  const ownerId = Number(leadOwnerId);

  if (Number.isNaN(leadId) || leadId <= 0) {
    return {
      synced: false,
      skipped: true,
      reason: `Invalid shape lead id: ${shapeLeadId}`,
    };
  }

  if (Number.isNaN(ownerId) || ownerId <= 0) {
    return {
      synced: false,
      skipped: true,
      reason: `Invalid lead_owner_id: ${leadOwnerId}`,
    };
  }

  const assignUrl = `${searchBase.replace(/\/+$/, '')}/assign/lead/owner/${leadId}`;
  const payload = {
    lead_id: leadId,
    lead_owner_id: ownerId,
  };

  const response = await fetch(assignUrl, {
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

  const message = String(shapeResponse.msg || shapeResponse.message || text || '').toLowerCase();
  const queued = message.includes('queued') || message.includes('processing');

  if (!response.ok) {
    return {
      synced: false,
      skipped: false,
      http_status: response.status,
      shape_response: shapeResponse,
      lead_owner_id: ownerId,
      error: `Shape owner assign rejected (${response.status})`,
      assign_url: assignUrl,
    };
  }

  return {
    synced: true,
    skipped: false,
    http_status: response.status,
    shape_response: shapeResponse,
    lead_owner_id: ownerId,
    assign_url: assignUrl,
    shape_queued_hint: queued,
  };
}
