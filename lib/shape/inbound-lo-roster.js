import { normalizePhoneDigits } from '../phone.js';

/**
 * Inbound Zoom call-answered LO roster.
 * Lookup priority: extension → direct phone (last 10) → display name.
 * Override: INBOUND_LO_ROSTER_JSON
 */
export const DEFAULT_INBOUND_LO_ROSTER = [
  { depursLo: 49, extension: '11825', phone10: '4709885559', email: 'tchisholm@questrock.com', dispositionId: 'tchisholm', names: ['Tashawna Chisholm'] },
  { depursLo: 40, extension: '11822', phone10: '4708900967', email: 'scurry@questrock.com', dispositionId: 'scurry', names: ['Stephen Curry'] },
  { depursLo: 37, extension: '11821', phone10: '4702312320', email: 'jsherard@questrock.com', dispositionId: 'jsherard', names: ['Jessica Sherard'] },
  { depursLo: 3, extension: '11815', phone10: '4708901236', email: 'nikksmith@questrock.com', dispositionId: 'nsmith', names: ['Nikkolas Smith', 'Nikk Smith', 'Nick Smith'] },
  { depursLo: 13, extension: '11813', phone10: '4708901809', email: 'bastianjohnston@questrock.com', dispositionId: 'bjohnston', names: ['Bastian Johnston'] },
  { depursLo: 34, extension: '11819', phone10: '4708901266', email: 'tjohnson@questrock.com', dispositionId: 'tjohnson', names: ['Tyler Johnson', 'Tyler Johnson TJ'] },
  { depursLo: 16, extension: '11816', phone10: '4708901223', email: 'rconway@questrock.com', dispositionId: 'rconway', names: ['Ray Conway'] },
  { depursLo: 50, extension: '11800', phone10: '6782222050', email: 'bmedley@questrock.com', dispositionId: 'questrock', names: ['QuestRock LLC', 'Bill Medley'] },
  { depursLo: 58, extension: '11828', phone10: '4708904801', email: 'gbethea@questrock.com', dispositionId: 'gbethea', names: ['Gregory Bethea Jr', 'Greg Bethea', 'Gregory Bethea'] },
  { depursLo: 55, extension: '11829', phone10: '4706286772', email: 'zdavis@questrock.com', dispositionId: 'zdavis', names: ['Zachary Davis', 'Zack Davis', 'Zach Davis', 'Zachary'] },
  { depursLo: 52, extension: '11827', phone10: '4706105546', email: 'jfriday@questrock.com', dispositionId: 'jfriday', names: ['Jason Friday', 'Jason'] },
];

function normalizeName(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

export function getInboundLoRoster() {
  const raw = process.env.INBOUND_LO_ROSTER_JSON;
  if (!raw?.trim()) {
    return DEFAULT_INBOUND_LO_ROSTER;
  }

  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length) {
      return parsed.map((row) => ({
        depursLo: Number(row.depursLo ?? row.leadOwnerId),
        extension: String(row.extension ?? '').replace(/\D/g, ''),
        phone10: String(row.phone10 ?? row.directnumber ?? '').replace(/\D/g, '').slice(-10),
        email: String(row.email ?? '').trim(),
        dispositionId: String(row.dispositionId ?? row.id ?? '').trim(),
        names: Array.isArray(row.names) ? row.names : Array.isArray(row.keys) ? row.keys : [row.name].filter(Boolean),
        displayName: row.displayName ?? row.display ?? row.names?.[0] ?? row.name,
      }));
    }
  } catch {
    // fall through
  }

  return DEFAULT_INBOUND_LO_ROSTER;
}

function rosterEntryDisplay(entry) {
  return entry.displayName ?? entry.names?.[0] ?? 'Unknown LO';
}

/**
 * Resolve LO from Zoom callee fields (who answered).
 */
export function resolveInboundLo({ calleeName, calleeExtension, calleePhone, acceptedByName } = {}) {
  const roster = getInboundLoRoster();

  const extension = String(calleeExtension ?? '').replace(/\D/g, '');
  if (extension) {
    for (const entry of roster) {
      if (entry.extension === extension) {
        return { ...entry, displayName: rosterEntryDisplay(entry), matchedBy: 'extension' };
      }
    }
  }

  const phone10 = normalizePhoneDigits(calleePhone);
  if (phone10?.length === 10) {
    for (const entry of roster) {
      if (entry.phone10 === phone10) {
        return { ...entry, displayName: rosterEntryDisplay(entry), matchedBy: 'phone' };
      }
    }
  }

  const nameCandidates = [acceptedByName, calleeName].map(normalizeName).filter(Boolean);
  for (const query of nameCandidates) {
    for (const entry of roster) {
      for (const name of entry.names ?? []) {
        if (normalizeName(name) === query) {
          return { ...entry, displayName: rosterEntryDisplay(entry), matchedBy: 'name' };
        }
      }
    }
  }

  return null;
}
