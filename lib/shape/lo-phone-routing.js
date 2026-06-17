/**
 * Inbound Zoom DID / extension → mailer LO roster name + Shape depursLo.
 * Override via LO_PHONE_ROUTING_JSON env if needed.
 */
export const DEFAULT_LO_PHONE_ROUTING = [
  { phone10: '4706286772', extension: '11829', loName: 'Zachary Davis', depursLo: 55 },
  { phone10: '4706105546', extension: '11827', loName: 'Jason Friday', depursLo: 52 },
  { phone10: '4708904801', extension: '11828', loName: 'Gregory Bethea Jr', depursLo: 58 },
];

function normalizeEntry(entry) {
  return {
    phone10: String(entry.phone10 ?? entry.phone ?? '').replace(/\D/g, '').slice(-10),
    extension: String(entry.extension ?? '').replace(/\D/g, ''),
    loName: String(entry.loName ?? entry.name ?? '').trim(),
    depursLo: Number(entry.depursLo ?? entry.leadOwnerId),
  };
}

export function getLoPhoneRouting() {
  const raw = process.env.LO_PHONE_ROUTING_JSON;
  if (!raw?.trim()) {
    return DEFAULT_LO_PHONE_ROUTING;
  }

  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length) {
      return parsed.map(normalizeEntry);
    }
  } catch {
    // fall through
  }

  return DEFAULT_LO_PHONE_ROUTING;
}

export function normalizePhone10(phone) {
  const digits = String(phone ?? '').replace(/\D/g, '');
  if (digits.length < 10) return '';
  return digits.slice(-10);
}

export function normalizeExtension(value) {
  const digits = String(value ?? '').replace(/\D/g, '');
  if (!digits || digits.length > 6) return '';
  return digits;
}

/**
 * Resolve LO from callee DID (10-digit phone) or Zoom extension (e.g. 11829).
 */
export function resolveLoFromPhone(phoneOrExtension) {
  const raw = String(phoneOrExtension ?? '').replace(/\D/g, '');
  if (!raw) return null;

  const routing = getLoPhoneRouting();

  if (raw.length <= 6) {
    for (const entry of routing) {
      if (entry.extension && entry.extension === raw) {
        return entry;
      }
    }
    return null;
  }

  const phone10 = raw.slice(-10);
  for (const entry of routing) {
    if (entry.phone10 === phone10) {
      return entry;
    }
  }

  return null;
}
