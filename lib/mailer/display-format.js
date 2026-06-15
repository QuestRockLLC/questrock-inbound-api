export function formatDisplayMoney(value) {
  const raw = String(value ?? '').trim();
  if (!raw) {
    return '';
  }
  if (raw.includes('$')) {
    return raw;
  }
  const num = Number(raw.replace(/[^0-9.]/g, ''));
  if (Number.isNaN(num)) {
    return raw;
  }
  return num.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
}

export function formatDisplayPercent(value) {
  const raw = String(value ?? '').trim();
  if (!raw) {
    return '';
  }
  if (raw.includes('%')) {
    return raw;
  }
  const num = Number(raw.replace(/[^0-9.]/g, ''));
  if (Number.isNaN(num)) {
    return raw;
  }
  if (num > 0 && num < 1) {
    const pct = num * 100;
    return `${pct.toFixed(3).replace(/\.?0+$/, '')}%`;
  }
  return `${num}%`;
}

const MONEY_FIELDS = ['mtg_amount', 'new_total_payment', 'debt_amount'];
const PERCENT_FIELDS = ['new_rate', 'new_apr'];

/** Formats loan amounts ($) and rates (%) on a mailer lead copy for LO Desk display. */
export function formatMailerLeadForDisplay(lead) {
  if (!lead) {
    return lead;
  }

  const out = { ...lead };

  for (const field of MONEY_FIELDS) {
    if (out[field]) {
      out[field] = formatDisplayMoney(out[field]) || out[field];
    }
  }

  for (const field of PERCENT_FIELDS) {
    if (out[field]) {
      out[field] = formatDisplayPercent(out[field]) || out[field];
    }
  }

  return out;
}

export function formatMailerMoneyOrDash(value) {
  const formatted = formatDisplayMoney(value);
  return formatted || '—';
}

export function formatMailerPercentOrDash(value) {
  const formatted = formatDisplayPercent(value);
  return formatted || '—';
}
