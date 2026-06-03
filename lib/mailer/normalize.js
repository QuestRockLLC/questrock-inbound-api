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

/** Servicer names we never send to Shape (case-insensitive word match). */
const SHAPE_REDACTED_LENDER_PATTERN = /\bcamber\b/i;

export function containsRedactedLenderName(value) {
  return SHAPE_REDACTED_LENDER_PATTERN.test(String(value ?? ''));
}

/**
 * Removes redacted lender tokens from any string posted to Shape.
 */
export function redactSensitiveLenderText(value) {
  const text = String(value ?? '');
  if (!text) {
    return '';
  }

  return text
    .replace(/\bcamber\b/gi, '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\|\s*\|/g, '|')
    .replace(/:\s*\|/g, ': ')
    .replace(/\|\s*$/g, '')
    .trim();
}

export function lenderForShapeExport(lender) {
  const raw = String(lender ?? '').trim();
  if (!raw || containsRedactedLenderName(raw)) {
    return undefined;
  }
  return redactSensitiveLenderText(raw) || undefined;
}

function formatMailerDisplayDate(value) {
  const raw = String(value ?? '').trim();
  if (!raw) {
    return '—';
  }

  const parsed = new Date(raw);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toLocaleDateString('en-US', {
      month: 'numeric',
      day: 'numeric',
      year: '2-digit',
    });
  }

  return raw;
}

export function buildMailerNotes(row) {
  const lenderLine = lenderForShapeExport(row.lender);
  const lines = [
    'Thursday Mailer Import (Shape source: Mail)',
    `Offer Code: ${row.reference_code}`,
    lenderLine
      ? `Mortgage: ${row.mtg_amount || '—'} | Lender: ${lenderLine}`
      : `Mortgage: ${row.mtg_amount || '—'}`,
    `Loan: ${row.loan_type || '—'} (${row.rate_type || '—'}) | Property date: ${formatMailerDisplayDate(row.property_date)}`,
    `Offer: ${row.new_rate || '—'} / ${row.new_apr || '—'} APR | New payment: ${row.new_total_payment || '—'}`,
    `Debt amount: ${row.debt_amount || '—'} | Mail: ${formatMailerDisplayDate(row.mail_date)} | Expires: ${formatMailerDisplayDate(row.offer_expires)}`,
  ];

  return lines.map((line) => redactSensitiveLenderText(line)).join('\r\n');
}

/** Strip $, %, commas for Shape currency/decimal fields. */
export function stripNumericField(value) {
  const raw = String(value ?? '').trim();
  if (!raw) {
    return undefined;
  }
  const cleaned = raw.replace(/[$,%\s]/g, '').replace(/,/g, '');
  return cleaned || undefined;
}

/**
 * Shape payload for Marketing Source "Mail" (postlead/20931/21580).
 * Offer Code → referralsource (primary) + mktreferencecode (backup).
 */
export function buildShapeLeadPayload(row) {
  const mtgBalance = stripNumericField(row.mtg_amount);
  const newPayment = stripNumericField(row.new_total_payment);
  const newRate = stripNumericField(row.new_rate);
  const newApr = stripNumericField(row.new_apr);
  const debtAmount = stripNumericField(row.debt_amount);

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
    referralsource: row.reference_code,
    mktreferencecode: row.reference_code,
    mktmailshopdropcode: row.reference_code,
    lonamtexistlien: mtgBalance,
    loncurrentloanbalnc: mtgBalance,
    currentMortgageProgram: row.loan_type || undefined,
    rateType: row.rate_type || undefined,
    intratequoted: newRate,
    targetRate: newRate,
    lonapr: newApr,
    proposedpmt: newPayment,
    borrower_current_debt_amount: debtAmount,
    loanDate: row.property_date || undefined,
    notes_sidebar: buildMailerNotes(row),
    mstrstatus1: process.env.SHAPE_MAILER_DEFAULT_STATUS || 'New Lead',
  };

  if (row.phone) {
    payload.phone = row.phone;
  }

  if (row.email) {
    payload.email = row.email;
  }

  const lenderName = lenderForShapeExport(row.lender);
  if (lenderName) {
    payload.rellendername = lenderName;
  }

  const leadsource = Number(process.env.SHAPE_MAILER_LEADSOURCE || '');
  if (!Number.isNaN(leadsource) && leadsource > 0) {
    payload.leadsource = leadsource;
  }

  const sanitized = Object.fromEntries(
    Object.entries(payload).map(([key, value]) => {
      if (typeof value !== 'string') {
        return [key, value];
      }
      return [key, redactSensitiveLenderText(value)];
    }),
  );

  return Object.fromEntries(
    Object.entries(sanitized).filter(([, value]) => value !== undefined && String(value).trim() !== ''),
  );
}
