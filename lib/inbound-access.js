import { getShapeLoRoster, resolveShapeLoUserId } from './shape/lo-roster.js';

const DEFAULT_ADMIN_EMAILS = ['arashid@questrock.com', 'nikksmith@questrock.com'];

/** QuestRock hub email → canonical mailer LO roster name */
const EMAIL_TO_LO_NAME = {
  'gbethea@questrock.com': 'Gregory Bethea Jr',
  'zdavis@questrock.com': 'Zachary Davis',
  'jfriday@questrock.com': 'Jason Friday',
  'bastianjohnston@questrock.com': 'Bastian Johnston',
  'tjohnson@questrock.com': 'Tyler Johnson',
  'tchisholm@questrock.com': 'Tashawna Chisholm',
  'nikksmith@questrock.com': 'Nikk Smith',
  'scurry@questrock.com': 'Stephen Curry',
  'jsherard@questrock.com': 'Jessica Sherard',
  'rayconway@questrock.com': 'Ray Conway',
};

const NAME_ALIASES = {
  greg: 'Gregory Bethea Jr',
  'gregory bethea': 'Gregory Bethea Jr',
  'gregory bethea jr': 'Gregory Bethea Jr',
  zack: 'Zachary Davis',
  zach: 'Zachary Davis',
  'zachary davis': 'Zachary Davis',
  jason: 'Jason Friday',
  'jason friday': 'Jason Friday',
  ray: 'Ray Conway',
  'ray conway': 'Ray Conway',
};

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

  const alias = NAME_ALIASES[query];
  if (alias && resolveShapeLoUserId(alias)) {
    return alias;
  }

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

  return '';
}

export function resolveInboundLoName(email, displayName) {
  const emailKey = String(email ?? '').trim().toLowerCase();
  const fromEmail = EMAIL_TO_LO_NAME[emailKey];
  if (fromEmail && resolveShapeLoUserId(fromEmail)) {
    return fromEmail;
  }

  const fromName = matchRosterLoName(displayName);
  if (fromName && resolveShapeLoUserId(fromName)) {
    return fromName;
  }

  return '';
}

export function buildInboundUserProfile(email, displayName) {
  const name = String(displayName ?? '').trim() || String(email).split('@')[0];
  const admin = isInboundAdmin(email);
  const loName = admin ? '' : resolveInboundLoName(email, name);
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
  // Lookup desk: any authenticated roster LO can view mailer leads (not assign-restricted).
  if (session.loName) return true;
  return false;
}

export { normalizeLoName };
