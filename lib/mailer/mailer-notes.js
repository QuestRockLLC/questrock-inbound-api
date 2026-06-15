import { formatMailerDateEst } from './mailer-dates.js';

const CAMBER_PATTERN = /\bcamber\b/i;

function redactSensitiveLenderText(value) {
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

function lenderForShapeExport(lender) {
  const raw = String(lender ?? '').trim();
  if (!raw || CAMBER_PATTERN.test(raw)) {
    return undefined;
  }
  return redactSensitiveLenderText(raw) || undefined;
}

function pickRawField(rawRow, aliases) {
  if (!rawRow || typeof rawRow !== 'object') {
    return '';
  }

  const map = new Map();
  for (const [key, value] of Object.entries(rawRow)) {
    const normalized = String(key ?? '')
      .trim()
      .toLowerCase()
      .replace(/[_-]+/g, ' ')
      .replace(/\s+/g, ' ');
    if (normalized) {
      map.set(normalized, value);
    }
  }

  for (const alias of aliases) {
    if (map.has(alias)) {
      const value = map.get(alias);
      if (value !== null && value !== undefined && String(value).trim() !== '') {
        return String(value).trim();
      }
    }
  }

  return '';
}

function fieldOrRaw(record, field, rawAliases) {
  const direct = String(record?.[field] ?? '').trim();
  if (direct) {
    return direct;
  }
  return pickRawField(record?.raw_row, rawAliases);
}

function line(label, value) {
  const v = String(value ?? '').trim();
  if (!v) {
    return null;
  }
  return `${label}: ${v}`;
}

/**
 * Plain-text Shape notes_sidebar for mailer leads (readable on the phone).
 */
export function buildMailerShapeNotes(row) {
  const lenderLine = lenderForShapeExport(row.lender);
  const propertyDate = row.property_date
    ? formatMailerDateEst(row.property_date) || row.property_date
    : '';

  const offerLines = [
    line('Offer code', row.reference_code),
    line('Loan amount', row.mtg_amount),
    line('Loan type', row.loan_type),
    line('New rate', row.new_rate),
    line('P&I payment (letter)', row.new_total_payment),
    lenderLine ? line('Lender', lenderLine) : null,
    propertyDate ? line('Property date', propertyDate) : null,
  ].filter(Boolean);

  const dateLines = [
    line('APR', row.new_apr),
    line('Mail date', formatMailerDateEst(fieldOrRaw(row, 'mail_date', ['mail date', 'maildate']))),
    line('Offer expires', formatMailerDateEst(
      fieldOrRaw(row, 'offer_expires', ['expir', 'expires', 'expiration', 'offer expires']),
    )),
    line('Current pay date', formatMailerDateEst(
      fieldOrRaw(row, 'curr_pay_date', ['curr pay', 'current pay']),
    )),
    line('New pay date', formatMailerDateEst(
      fieldOrRaw(row, 'new_pay_date', ['new pay', 'new pay date']),
    )),
  ].filter(Boolean);

  const sections = ['QuestMail mailer import'];

  if (offerLines.length) {
    sections.push('', '— Offer —', ...offerLines);
  }

  if (dateLines.length) {
    sections.push('', '— Dates & APR (EST) —', ...dateLines);
  }

  return sections.map((lineText) => redactSensitiveLenderText(lineText)).join('\n');
}

/** @deprecated use buildMailerShapeNotes sections */
export function buildMailerSidebarDetailLines(record) {
  return buildMailerShapeNotes(record)
    .split('\n')
    .filter((l) => l.startsWith('APR:') || l.includes('date') || l.includes('expires'));
}
