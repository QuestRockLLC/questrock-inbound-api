/**
 * QuestRock mailer LO desk → Shape depursLo (LOA user id).
 * Override via SHAPE_LO_ROSTER_JSON env if needed.
 */
export const DEFAULT_SHAPE_LO_ROSTER = [
  { name: 'Tashawna Chisholm', depursLo: 49 },
  { name: 'Stephen Curry', depursLo: 40 },
  { name: 'Jessica Sherard', depursLo: 37 },
  { name: 'Tyler Johnson', depursLo: 34 },
  { name: 'Bastian Johnston', depursLo: 13 },
  { name: 'Nikk Smith', depursLo: 3 },
];

export function getShapeLoRoster() {
  const raw = process.env.SHAPE_LO_ROSTER_JSON;
  if (!raw?.trim()) {
    return DEFAULT_SHAPE_LO_ROSTER;
  }

  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length) {
      return parsed.map((entry) => ({
        name: String(entry.name ?? '').trim(),
        depursLo: Number(entry.depursLo ?? entry.id),
      }));
    }
  } catch {
    // fall through
  }

  return DEFAULT_SHAPE_LO_ROSTER;
}

function normalizeLoName(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

/**
 * Resolves LO display name to Shape depursLo user id.
 */
export function resolveShapeLoUserId(loName) {
  const query = normalizeLoName(loName);
  if (!query) {
    return null;
  }

  const roster = getShapeLoRoster();

  for (const entry of roster) {
    if (normalizeLoName(entry.name) === query) {
      return entry.depursLo;
    }
  }

  for (const entry of roster) {
    const parts = normalizeLoName(entry.name).split(' ');
    const last = parts[parts.length - 1];
    const first = parts[0];
    if (query === last || query === first) {
      return entry.depursLo;
    }
    if (query.includes(last) && query.includes(first)) {
      return entry.depursLo;
    }
  }

  return null;
}
