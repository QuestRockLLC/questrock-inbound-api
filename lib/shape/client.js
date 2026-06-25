const DEFAULT_SEARCH_BASE = 'https://secure-api.setshape.com/api';
/** QuestRock-verified: leadid + systemid in body; no CRM id in path. */
const DEFAULT_UPDATE_URL = 'https://secure.setshape.com/api/update/lead/info';
/** Legacy OpenAPI host — requires /update/lead/info/{crmid} in path. */
const LEGACY_UPDATE_URL = 'https://secure-api.setshape.com/api/update/lead/info';

const TRANSCRIPT_SYNC_DISABLED_REASON =
  'Inbound Zoom transcript Shape sync disabled (set SHAPE_TRANSCRIPT_SYNC_ENABLED=false to disable)';

/**
 * OpenAPI search/update for /api/zoom-transcript and re-evaluate only.
 * Mailer import uses postlead and is not gated by this flag.
 * Sync is ON by default — set SHAPE_TRANSCRIPT_SYNC_ENABLED=false to disable.
 */
export function isShapeTranscriptSyncEnabled() {
  const flag = String(process.env.SHAPE_TRANSCRIPT_SYNC_ENABLED ?? 'true')
    .trim()
    .toLowerCase();
  return flag !== 'false' && flag !== '0' && flag !== 'no';
}

function resolveShapeUpdateUrl(updateUrl, crmId) {
  const base = String(updateUrl || DEFAULT_UPDATE_URL).replace(/\/+$/, '');
  const id = String(crmId ?? '').trim();

  // secure.setshape.com — CRM id belongs in JSON (systemid), not the URL path.
  if (base.includes('secure.setshape.com')) {
    return base;
  }

  // secure-api.setshape.com — POST /update/lead/info/{crmid}
  if (!id) {
    return base;
  }
  if (base.endsWith(`/${id}`)) {
    return base;
  }
  return `${base}/${id}`;
}

function readShapeCrmId() {
  return String(
    process.env.SHAPE_CRM_ID || process.env.SHAPE_ACCOUNT_ID || process.env.CRM_ID || '',
  ).trim();
}

/** Ordered URLs to try; secure.setshape.com first, then secure-api with CRM path. */
export function getShapeUpdateUrlCandidates() {
  const crmId = readShapeCrmId();
  const configured = process.env.SHAPE_UPDATE_URL?.trim();
  const candidates = [];

  if (configured) {
    candidates.push(resolveShapeUpdateUrl(configured, crmId));
  }
  candidates.push(resolveShapeUpdateUrl(DEFAULT_UPDATE_URL, crmId));
  if (crmId) {
    candidates.push(resolveShapeUpdateUrl(LEGACY_UPDATE_URL, crmId));
  }

  return [...new Set(candidates.filter(Boolean))];
}

function getShapeConfig() {
  const apiKey = process.env.SHAPE_API_KEY || process.env.SHAPE_ACCESS_TOKEN;
  const crmId = readShapeCrmId();
  const searchBase = (process.env.SHAPE_BASE_URL || DEFAULT_SEARCH_BASE).replace(/\/+$/, '');
  const updateUrl = getShapeUpdateUrlCandidates()[0] ?? resolveShapeUpdateUrl(DEFAULT_UPDATE_URL, crmId);

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

/**
 * Loads full Shape lead fields (including notes_sidebar) — not gated by transcript sync flag.
 * Used for mailer archive / bulk enrich.
 */
export async function fetchShapeLeadDetails(shapeLeadId) {
  const { apiKey, crmId, searchBase } = getShapeConfig();

  if (!apiKey || !crmId) {
    return {
      lead: {},
      configured: false,
      skipped: true,
      reason: 'Missing SHAPE_API_KEY or SHAPE_CRM_ID',
    };
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
    return {
      lead: {},
      configured: true,
      skipped: false,
      http_status: response.status,
      shape_response: json,
      error: `Shape search failed (${response.status})`,
    };
  }

  return {
    lead: unwrapLead(json),
    configured: true,
    http_status: response.status,
    shape_response: json,
  };
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
 * Sends arbitrary field updates to Shape for a single lead.
 * Not gated by transcript-sync flag — usable from any endpoint.
 */
export async function updateShapeLeadFields(shapeLeadId, fields = {}) {
  const { apiKey } = getShapeConfig();

  if (!apiKey) {
    return { synced: false, skipped: true, reason: 'Missing SHAPE_API_KEY' };
  }

  if (!fields || Object.keys(fields).length === 0) {
    return { synced: false, skipped: true, reason: 'No fields to update' };
  }

  const leadid = Number(shapeLeadId);
  if (Number.isNaN(leadid) || leadid <= 0) {
    return { synced: false, skipped: true, reason: `Invalid shape_lead_id: ${shapeLeadId}` };
  }

  const payload = withSystemId({ leadid, ...fields });
  const urls = getShapeUpdateUrlCandidates();

  let lastFailure = null;

  for (const updateUrl of urls) {
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

    if (response.ok) {
      return {
        synced: true,
        http_status: response.status,
        shape_response: shapeResponse,
        fields_sent: Object.keys(fields),
        update_url: updateUrl,
      };
    }

    lastFailure = {
      synced: false,
      http_status: response.status,
      shape_response: shapeResponse,
      fields_sent: Object.keys(fields),
      update_url: updateUrl,
      error: `Shape update rejected (${response.status})`,
    };

    // Try fallback URL only on path-not-found style failures.
    if (response.status !== 404) {
      break;
    }
  }

  return lastFailure ?? {
    synced: false,
    skipped: true,
    reason: 'No Shape update URL configured',
  };
}

/**
 * Updates Shape lead status (mstrstatus1) and AI-extracted fields.
 * directFields — Zapier payload fields (phone, name, etc.) merged in before AI fields.
 * AI fields win on collision so the best-extracted value always takes precedence.
 */
export async function syncShapeLeadFromEvaluation(shapeLeadId, evaluation, directFields = {}) {
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

  // directFields = reliable caller-ID / Zapier-lookup values
  // evaluation.fieldsPopulated = AI-extracted; wins on collision
  const payload = withSystemId({
    leadid,
    mstrstatus1: evaluation.status.status_label,
    ...directFields,
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

  const allFieldsSent = { ...directFields, ...evaluation.fieldsPopulated };

  if (!response.ok) {
    return {
      synced: false,
      skipped: false,
      http_status: response.status,
      shape_response: shapeResponse,
      fields_sent: Object.keys(allFieldsSent),
      direct_fields_sent: Object.keys(directFields),
      ai_fields_sent: Object.keys(evaluation.fieldsPopulated),
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
    fields_sent: Object.keys(allFieldsSent),
    direct_fields_sent: Object.keys(directFields),
    ai_fields_sent: Object.keys(evaluation.fieldsPopulated),
    status_sent: evaluation.status.status_label,
    update_url: updateUrl,
  };
}

const DEFAULT_MAIL_POST_LEAD_URL = 'https://secure-api.setshape.com/postlead/20931/21580';
const DEFAULT_INBOUND_POST_LEAD_URL = 'https://secure-api.setshape.com/postlead/20931/21571';

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

function getShapeInboundPostLeadUrl() {
  const direct = (process.env.SHAPE_INBOUND_POST_LEAD_URL || '').trim();
  if (direct) {
    return direct;
  }

  const crmId = String(
    process.env.SHAPE_CRM_ID || process.env.SHAPE_ACCOUNT_ID || process.env.CRM_ID || '20931',
  ).trim();
  const sourceId = String(process.env.SHAPE_INBOUND_SOURCE_ID || '21571').trim();

  if (!crmId || !sourceId) {
    return DEFAULT_INBOUND_POST_LEAD_URL;
  }

  return `https://secure-api.setshape.com/postlead/${crmId}/${sourceId}`;
}

async function postShapeLead(postUrl, payload) {
  const apiKey = process.env.SHAPE_API_KEY || process.env.SHAPE_ACCESS_TOKEN || '';
  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
  };
  if (apiKey) {
    headers.Authorization = apiKey;
  }

  const response = await fetch(postUrl, {
    method: 'POST',
    headers,
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
      post_url: postUrl,
    };
  }

  if (!shapeLeadId) {
    return {
      created: false,
      skipped: false,
      http_status: response.status,
      shape_response: shapeResponse,
      error: 'Shape postlead succeeded but no lead ID was returned',
      post_url: postUrl,
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

  return postShapeLead(postUrl, payload);
}

/**
 * Creates inbound Zoom call lead via Inbound Zoom Phone marketing source (21571).
 */
export async function createShapeInboundLead(payload) {
  const postUrl = getShapeInboundPostLeadUrl();
  return postShapeLead(postUrl, payload);
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
