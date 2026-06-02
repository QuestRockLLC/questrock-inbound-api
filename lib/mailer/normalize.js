/**
 * Maps spreadsheet header variants to normalized mailer row fields.
 */
export const MAILER_FIELD_ALIASES = {
  reference_code: ['offer code', 'offercode', 'reference code', 'referencecode', 'ref code'],
  full_name: ['full name', 'fullname', 'name'],
  first_name: ['first name', 'firstname', 'first'],
  last_name: ['last name', 'lastname', 'last'],
  address_line_1: ['address line 1', 'address 1', 'address1', 'street', 'property address'],
  address_line_2: ['address line 2', 'address 2', 'address2'],
  city: ['city'],
  state: ['state'],
  zip_code: ['zip code', 'zip', 'zipcode', 'postal code'],
  county: ['county'],
  mtg_amount: ['mtgamt', 'mtg amount', 'mortgage amount', 'mortgage balance'],
  property_date: ['properdate', 'property date', 'prop date'],
  lender: ['lender'],
  loan_type: ['type', 'loan type'],
  rate_type: ['rate type', 'ratetype'],
  new_rate: ['new rate'],
  new_apr: ['new apr', 'newapr'],
  debt_amount: ['debtamt', 'debt amount'],
  new_total_payment: ['newtotpay', 'new total pay', 'new total payment'],
  mail_date: ['mail date', 'maildate'],
  offer_expires: ['expir', 'expires', 'expiration', 'offer expires'],
  phone: ['phone', 'phone number', 'mobile phone'],
  email: ['email', 'email address'],
};

function normalizeHeader(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ');
}

/**
 * @param {Record<string, unknown>} rawRow
 */
export function normalizeMailerRow(rawRow) {
  if (!rawRow || typeof rawRow !== 'object') {
    return null;
  }

  const headerMap = new Map();

  for (const [rawKey, rawValue] of Object.entries(rawRow)) {
    const normalizedKey = normalizeHeader(rawKey);
    if (!normalizedKey) {
      continue;
    }
    headerMap.set(normalizedKey, rawValue);
  }

  const row = {};

  for (const [field, aliases] of Object.entries(MAILER_FIELD_ALIASES)) {
    for (const alias of aliases) {
      if (headerMap.has(alias)) {
        const value = headerMap.get(alias);
        row[field] = value === null || value === undefined ? '' : String(value).trim();
        break;
      }
    }
  }

  if (!row.reference_code) {
    return null;
  }

  if (!row.full_name && row.first_name && row.last_name) {
    row.full_name = `${row.first_name} ${row.last_name}`.trim();
  }

  if (!row.first_name && row.full_name) {
    const parts = row.full_name.split(/\s+/);
    row.first_name = parts[0] ?? '';
    row.last_name = parts.slice(1).join(' ');
  }

  row.reference_code = row.reference_code.toUpperCase();

  return row;
}

/**
 * @param {Record<string, unknown>[]} rawRows
 */
export function normalizeMailerRows(rawRows) {
  const normalized = [];
  const skipped = [];

  for (let index = 0; index < rawRows.length; index += 1) {
    const row = normalizeMailerRow(rawRows[index]);
    if (!row) {
      skipped.push({ index: index + 1, reason: 'Missing Offer Code / reference_code' });
      continue;
    }
    normalized.push({ index: index + 1, row, raw: rawRows[index] });
  }

  return { normalized, skipped };
}

export function buildMailerNotes(row) {
  const lines = [
    'Thursday Mailer Import',
    `Offer Code: ${row.reference_code}`,
    `Mortgage: ${row.mtg_amount || '—'} | Lender: ${row.lender || '—'}`,
    `Loan: ${row.loan_type || '—'} (${row.rate_type || '—'}) | Property date: ${row.property_date || '—'}`,
    `Offer: ${row.new_rate || '—'} / ${row.new_apr || '—'} APR | New payment: ${row.new_total_payment || '—'}`,
    `Debt amount: ${row.debt_amount || '—'} | Mail: ${row.mail_date || '—'} | Expires: ${row.offer_expires || '—'}`,
  ];

  return lines.join('\n');
}

export function buildShapeLeadPayload(row) {
  const leadsource = Number(process.env.SHAPE_MAILER_LEADSOURCE || process.env.SHAPE_MAILER_SOURCE_ID || '');

  const payload = {
    firstname: row.first_name || undefined,
    lastname: row.last_name || undefined,
    leadfullname: row.full_name || undefined,
    prStreetAddress: row.address_line_1 || undefined,
    prAddressLine2: row.address_line_2 || undefined,
    prCity: row.city || undefined,
    prState: row.state || undefined,
    prZipCode: row.zip_code || undefined,
    prCounty: row.county || undefined,
    address2: row.address_line_1 || undefined,
    city: row.city || undefined,
    state: row.state || undefined,
    zip: row.zip_code || undefined,
    mktreferencecode: row.reference_code,
    leadreferenceid: row.reference_code,
    notes_sidebar: buildMailerNotes(row),
    mstrstatus1: process.env.SHAPE_MAILER_DEFAULT_STATUS || 'Not Contacted',
  };

  if (row.phone) {
    payload.phone = row.phone;
  }

  if (row.email) {
    payload.email = row.email;
  }

  if (!Number.isNaN(leadsource) && leadsource > 0) {
    payload.leadsource = leadsource;
  }

  return Object.fromEntries(
    Object.entries(payload).filter(([, value]) => value !== undefined && String(value).trim() !== ''),
  );
}
