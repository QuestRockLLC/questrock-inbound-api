const DEFAULT_BULK_EXPORT_URL = 'https://secure.setshape.com/api/leads/bulk/export';

export const DEFAULT_BULK_EXPORT_FIELDS = [
  'leadid',
  'firstname',
  'lastname',
  'email',
  'phone',
  'leadsource',
  'mstrstatus1',
  'createdDate',
  'lastActivityDate',
  'boraddress',
  'borcity',
  'borstate',
  'borzip',
  'prStreetAddress',
  'prCity',
  'prState',
  'prZipCode',
  'LoanAmount',
  'borpurchasePrice',
  'downpmtamount2',
  'loan_estAppraisalVal',
  'borcreditscore',
  'purpose',
  'depursLo',
  'referralsource',
  'notes_sidebar',
  'notes_sidebar_ai_note',
  'recent_notes',
];

function getBulkExportConfig() {
  const apiKey = process.env.SHAPE_API_KEY || process.env.SHAPE_ACCESS_TOKEN;
  const exportUrl = (process.env.SHAPE_BULK_EXPORT_URL || DEFAULT_BULK_EXPORT_URL).trim();
  return { apiKey, exportUrl };
}

function unwrapBulkLeads(json) {
  if (!json || typeof json !== 'object') {
    return [];
  }

  if (Array.isArray(json)) {
    return json.map(normalizeBulkLeadRow);
  }

  for (const key of ['data', 'leads', 'records', 'results', 'items']) {
    if (Array.isArray(json[key])) {
      return json[key].map(normalizeBulkLeadRow);
    }
  }

  if (json.data && typeof json.data === 'object' && !Array.isArray(json.data)) {
    const objectValues = Object.values(json.data);
    if (objectValues.length && typeof objectValues[0] === 'object') {
      return objectValues.map(normalizeBulkLeadRow);
    }

    for (const key of ['leads', 'records', 'items']) {
      if (Array.isArray(json.data[key])) {
        return json.data[key].map(normalizeBulkLeadRow);
      }
    }
  }

  return [];
}

function pickField(raw, ...keys) {
  for (const key of keys) {
    const value = raw?.[key];
    if (value != null && String(value).trim() !== '') {
      return value;
    }
  }
  return null;
}

/**
 * Shape bulk export returns display labels ("Source", "Lead ID") — normalize to API-style keys too.
 */
export function normalizeBulkLeadRow(raw) {
  if (!raw || typeof raw !== 'object') {
    return raw;
  }

  return {
    ...raw,
    leadid: pickField(raw, 'leadid', 'Lead ID', 'id'),
    firstname: pickField(raw, 'firstname', 'First Name'),
    lastname: pickField(raw, 'lastname', 'Last Name'),
    email: pickField(raw, 'email', 'Email'),
    phone: pickField(raw, 'phone', 'Mobile Phone', 'Phone'),
    leadsource: pickField(raw, 'leadsource', 'Source', 'source'),
    mstrstatus1: pickField(raw, 'mstrstatus1', 'Lead Status'),
    createdDate: pickField(raw, 'createdDate', 'Created Date'),
    lastActivityDate: pickField(raw, 'lastActivityDate', 'Last Activity Date'),
    boraddress: pickField(raw, 'boraddress', 'Present Address'),
    borcity: pickField(raw, 'borcity', 'Present City'),
    borstate: pickField(raw, 'borstate', 'Present State'),
    borzip: pickField(raw, 'borzip', 'Present Zip'),
    prStreetAddress: pickField(raw, 'prStreetAddress', 'Property Street Address', 'Property Address'),
    prCity: pickField(raw, 'prCity', 'Property City'),
    prState: pickField(raw, 'prState', 'Property State'),
    prZipCode: pickField(raw, 'prZipCode', 'Property Zip'),
    LoanAmount: pickField(raw, 'LoanAmount', 'Loan Amount'),
    borpurchasePrice: pickField(raw, 'borpurchasePrice', 'Purchase Price'),
    downpmtamount2: pickField(raw, 'downpmtamount2', 'Down Payment'),
    loan_estAppraisalVal: pickField(raw, 'loan_estAppraisalVal', 'Appraisal Value'),
    borcreditscore: pickField(raw, 'borcreditscore', 'Credit Score'),
    purpose: pickField(raw, 'purpose', 'Purpose'),
    depursLo: pickField(raw, 'depursLo', 'LOA User Name'),
    referralsource: pickField(raw, 'referralsource', 'Referral Source'),
    notes_sidebar: pickField(raw, 'notes_sidebar', 'Notes Sidebar'),
    notes_sidebar_ai_note: pickField(raw, 'notes_sidebar_ai_note', 'Notes Sidebar AI Note'),
    recent_notes: pickField(raw, 'recent_notes', 'Recent Note'),
  };
}

/**
 * One page of Shape bulk export (50 records max per Shape docs).
 */
export async function fetchShapeBulkExportPage({
  from,
  to,
  pageNumber = 1,
  fields = DEFAULT_BULK_EXPORT_FIELDS,
}) {
  const { apiKey, exportUrl } = getBulkExportConfig();

  if (!apiKey) {
    const error = new Error('Missing SHAPE_API_KEY for bulk export.');
    error.statusCode = 503;
    throw error;
  }

  const payload = {
    createdDateRange: {
      from,
      to,
      pageNumber: String(pageNumber),
    },
    fields,
  };

  const response = await fetch(exportUrl, {
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
    shapeResponse = { raw: text.slice(0, 800) };
  }

  if (!response.ok) {
    const error = new Error(`Shape bulk export failed (${response.status})`);
    error.statusCode = 502;
    error.shapeResponse = shapeResponse;
    throw error;
  }

  const leads = unwrapBulkLeads(shapeResponse);

  return {
    pageNumber,
    leads,
    leadCount: leads.length,
    hasMore: leads.length >= 50,
    shapeResponse,
    exportUrl,
  };
}
