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

/**
 * APR + last four date columns for Shape notes_sidebar (not main lead fields).
 */
export function buildMailerSidebarDetailLines(record) {
  const lines = [];

  const newApr = String(record?.new_apr ?? '').trim();
  if (newApr) {
    lines.push(`New APR: ${newApr}`);
  }

  const mailDate = formatMailerDateEst(fieldOrRaw(record, 'mail_date', ['mail date', 'maildate']));
  if (mailDate) {
    lines.push(`Mail date (EST): ${mailDate}`);
  }

  const expires = formatMailerDateEst(
    fieldOrRaw(record, 'offer_expires', ['expir', 'expires', 'expiration', 'offer expires']),
  );
  if (expires) {
    lines.push(`Offer expires (EST): ${expires}`);
  }

  const currPay = formatMailerDateEst(fieldOrRaw(record, 'curr_pay_date', ['curr pay', 'current pay']));
  if (currPay) {
    lines.push(`Current pay date (EST): ${currPay}`);
  }

  const newPay = formatMailerDateEst(fieldOrRaw(record, 'new_pay_date', ['new pay', 'new pay date']));
  if (newPay) {
    lines.push(`New pay date (EST): ${newPay}`);
  }

  return lines;
}

/**
 * Full Shape notes_sidebar body for mailer import.
 */
export function buildMailerShapeNotes(row) {
  const lenderLine = lenderForShapeExport(row.lender);
  const headline = [
    'Thursday Mailer Import (Shape source: Mail)',
    `Offer code: ${row.reference_code}`,
    `Loan amount: ${row.mtg_amount || '—'}`,
    lenderLine ? `Lender: ${lenderLine}` : null,
    `Loan type: ${row.loan_type || '—'}`,
    `New rate: ${row.new_rate || '—'}`,
    `New principal & interest (letter): ${row.new_total_payment || '—'}`,
    row.property_date ? `Property date: ${formatMailerDateEst(row.property_date) || row.property_date}` : null,
  ].filter(Boolean);

  const sidebarLines = buildMailerSidebarDetailLines(row);
  const lines = [...headline];

  if (sidebarLines.length) {
    lines.push('---');
    lines.push(...sidebarLines);
  }

  return lines.map((line) => redactSensitiveLenderText(line)).join('\r\n');
}
