const DEFAULT_EXCLUDED = [
  'mail',
  'referral partner',
  'referral partners',
  'contact',
  'zweblead - visit',
];

function normalizeSourceLabel(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

export function resolveLeadSourceLabel(lead) {
  const raw =
    lead?.leadsource ??
    lead?.lead_source ??
    lead?.LeadSource ??
    lead?.leadSource ??
    lead?.Source ??
    lead?.source ??
    '';

  if (typeof raw === 'object' && raw !== null) {
    return String(raw.name ?? raw.label ?? raw.value ?? '').trim();
  }

  return String(raw).trim();
}

export function getShapeTrackerExcludedSources() {
  const raw = process.env.SHAPE_TRACKER_EXCLUDED_SOURCES?.trim();
  if (!raw) {
    return DEFAULT_EXCLUDED;
  }

  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length) {
      return parsed.map((value) => normalizeSourceLabel(value));
    }
  } catch {
    return raw
      .split(',')
      .map((value) => normalizeSourceLabel(value))
      .filter(Boolean);
  }

  return DEFAULT_EXCLUDED;
}

export function isShapeSourceExcluded(lead) {
  const label = normalizeSourceLabel(resolveLeadSourceLabel(lead));
  if (!label) {
    return false;
  }

  const excluded = getShapeTrackerExcludedSources();
  return excluded.some(
    (noise) => label === noise || label.includes(noise) || noise.includes(label),
  );
}
