import { buildShapeProspectUrl } from '../shape/prospect-url.js';
import { getInboundLoRoster } from '../shape/inbound-lo-roster.js';

const LENDINGPAD_PORTAL_URL = (
  process.env.LENDINGPAD_PORTAL_URL || 'https://prod.lendingpad.com/questrock-llc/login'
).trim();

export function resolveLoDisplayName(meta = {}, lead = {}) {
  if (meta.lo_name?.trim()) return meta.lo_name.trim();

  const depursLo = meta.depurs_lo ?? meta.depursLo ?? lead.depursLo ?? null;
  if (depursLo != null) {
    const entry = getInboundLoRoster().find((row) => Number(row.depursLo) === Number(depursLo));
    if (entry?.names?.[0]) return entry.names[0];
  }

  if (lead.assigned_lo_name?.trim()) return lead.assigned_lo_name.trim();

  return null;
}

export function resolveShapeUrl(shapeLeadId) {
  return buildShapeProspectUrl(shapeLeadId);
}

export function resolveLendingPadUrl(extractedFields = [], meta = {}) {
  const fromMeta = meta.lendingpad_loan_uuid || meta.lendingpad_url;
  if (fromMeta && String(fromMeta).includes('lendingpad')) {
    return String(fromMeta).trim();
  }
  if (fromMeta && /^[0-9a-f-]{36}$/i.test(String(fromMeta))) {
    return `https://app.lendingpad.com/loans/${fromMeta}`;
  }

  for (const row of extractedFields || []) {
    const field = String(row.field || '').toLowerCase();
    const value = String(row.value || '').trim();
    if (!value) continue;
    if (field.includes('lendingpad') && value.includes('http')) return value;
    if (/^[0-9a-f-]{36}$/i.test(value) && field.includes('loan')) {
      return `https://app.lendingpad.com/loans/${value}`;
    }
  }

  return LENDINGPAD_PORTAL_URL;
}

/** Prefer LO disposition synced to Shape, then Shape CRM status, then AI suggestion. */
export function resolveCrmStatusLabel(record) {
  if (record.lo_disposition_label?.trim()) {
    return { label: record.lo_disposition_label.trim(), source: 'lo_disposition' };
  }
  if (record.lead_status_label?.trim()) {
    return { label: record.lead_status_label.trim(), source: 'shape' };
  }
  if (record.ai_status_label?.trim()) {
    return { label: record.ai_status_label.trim(), source: 'ai' };
  }
  return { label: null, source: null };
}
