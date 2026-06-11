import { getShapeLoRoster } from './shape/lo-roster.js';

const DEFAULT_ADMIN_EMAILS = ['arashid@questrock.com', 'nikksmith@questrock.com'];

export function getInboundAdminEmails() {
  const fromEnv = process.env.INBOUND_ADMIN_EMAILS?.trim();
  const list = fromEnv
    ? fromEnv.split(',').map((e) => e.trim().toLowerCase()).filter(Boolean)
    : DEFAULT_ADMIN_EMAILS;
  return new Set(list.map((e) => e.toLowerCase()));
}

export function isInboundAdmin(email) {
  if (!email) return false;
  return getInboundAdminEmails().has(String(email).trim().toLowerCase());
}

function normalizeLoName(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

export function matchRosterLoName(displayName) {
  const query = normalizeLoName(displayName);
  if (!query) return '';

  const roster = getShapeLoRoster();
  for (const entry of roster) {
    if (normalizeLoName(entry.name) === query) {
      return entry.name;
    }
  }

  for (const entry of roster) {
    const parts = normalizeLoName(entry.name).split(' ');
    const last = parts[parts.length - 1];
    const first = parts[0];
    if (query === last || query === first) {
      return entry.name;
    }
    if (query.includes(last) && query.includes(first)) {
      return entry.name;
    }
  }

  return String(displayName ?? '').trim();
}

export function buildInboundUserProfile(email, displayName) {
  const name = String(displayName ?? '').trim() || String(email).split('@')[0];
  const admin = isInboundAdmin(email);
  const loName = matchRosterLoName(name);
  return {
    email: String(email).trim().toLowerCase(),
    name,
    isAdmin: admin,
    loName,
    defaultPath: admin ? '/mailer-import/' : '/mailer-lo/',
  };
}

export function canAccessLead(session, mailerLead) {
  if (!session) return false;
  if (session.isAdmin) return true;
  if (!session.loName) return false;

  const assigned = mailerLead?.assigned_lo_name;
  if (!assigned) return true;
  return normalizeLoName(assigned) === normalizeLoName(session.loName);
}

export { normalizeLoName };
