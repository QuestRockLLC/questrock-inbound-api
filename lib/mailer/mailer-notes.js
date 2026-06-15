import { formatMailerDateEst } from './mailer-dates.js';
import { formatDisplayMoney, formatDisplayPercent } from './display-format.js';

const CAMBER_PATTERN = /\bcamber\b/i;
/** Shape notes_sidebar renders <br> reliably; plain \n shows as "n" in their UI. */
const NOTE_BREAK = '<br>';

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
 * Shape notes_sidebar for mailer leads (HTML line breaks for Shape UI).
 */
export function buildMailerShapeNotes(row) {
  const lenderLine = lenderForShapeExport(row.lender);
  const propertyDate = row.property_date
    ? formatMailerDateEst(row.property_date) || row.property_date
    : '';

  const offerLines = [
    line('Offer code', row.reference_code),
    line('Loan amount', formatDisplayMoney(row.mtg_amount)),
    line('Loan type', row.loan_type),
    line('New rate', formatDisplayPercent(row.new_rate)),
    line('P&I payment (letter)', formatDisplayMoney(row.new_total_payment) || row.new_total_payment),
    lenderLine ? line('Lender', lenderLine) : null,
    propertyDate ? line('Property date', propertyDate) : null,
  ].filter(Boolean);

  const dateLines = [
    line('APR', formatDisplayPercent(row.new_apr)),
    line('Mail date', formatMailerDateEst(fieldOrRaw(row, 'mail_date', ['mail date', 'maildate']))),
    line(
      'Offer expires',
      formatMailerDateEst(
        fieldOrRaw(row, 'offer_expires', ['expir', 'expires', 'expiration', 'offer expires']),
      ),
    ),
    line(
      'Current pay date',
      formatMailerDateEst(fieldOrRaw(row, 'curr_pay_date', ['curr pay', 'current pay'])),
    ),
    line(
      'New pay date',
      formatMailerDateEst(fieldOrRaw(row, 'new_pay_date', ['new pay', 'new pay date'])),
    ),
  ].filter(Boolean);

  const sections = ['QuestMail mailer import'];

  if (offerLines.length) {
    sections.push('', 'OFFER', ...offerLines);
  }

  if (dateLines.length) {
    sections.push('', 'DATES & APR (EST)', ...dateLines);
  }

  return sections
    .map((lineText) => redactSensitiveLenderText(lineText))
    .filter((lineText) => lineText !== '')
    .join(NOTE_BREAK);
}

export function buildMailerSidebarDetailLines(record) {
  const text = buildMailerShapeNotes(record).replace(/<br>/g, '\n');
  return text
    .split('\n')
    .filter((l) => l.startsWith('APR:') || l.toLowerCase().includes('date') || l.includes('expires'));
}
