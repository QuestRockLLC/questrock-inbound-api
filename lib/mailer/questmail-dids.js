import { normalizePhoneDigits } from '../phone.js';

/**
 * QuestMail toll-free numbers printed on weekly mail.
 * Each forwards to a state landing page DID (see forwardsTo) then into Zoom.
 * Identification uses the TOLL number when Zoom exposes it on the webhook.
 */
export const DEFAULT_QUESTMAIL_DIDS = [
  {
    phone10: '8662250926',
    state: 'FL',
    label: '624 QR INT 1250 FL',
    mailerType: 'INT',
    forwardsTo: '2392419600',
  },
  {
    phone10: '8662608397',
    state: 'FL',
    label: '624 QR ITA 1250 FL',
    mailerType: 'ITA',
    forwardsTo: '2392419600',
  },
  {
    phone10: '8777242152',
    state: 'GA',
    label: '624 QR INT 1250 GA',
    mailerType: 'INT',
    forwardsTo: '6782222021',
  },
  {
    phone10: '8662601936',
    state: 'GA',
    label: '624 QR ITA 1250 GA',
    mailerType: 'ITA',
    forwardsTo: '6782222021',
  },
  {
    phone10: '8667953457',
    state: 'NC',
    label: '624 QR ITA 1250 NC',
    mailerType: 'ITA',
    forwardsTo: '7042275017',
  },
  {
    phone10: '8775860275',
    state: 'NC',
    label: '624 QR INT 1250 NC',
    mailerType: 'INT',
    forwardsTo: '7042275017',
  },
  {
    phone10: '8772308287',
    state: 'TN',
    label: '624 QR ITA 1250 TN',
    mailerType: 'ITA',
    forwardsTo: '6158619441',
  },
  {
    phone10: '8778610843',
    state: 'TN',
    label: '624 QR INT 1250 TN',
    mailerType: 'INT',
    forwardsTo: '6158619441',
  },
  {
    phone10: '8775124460',
    state: 'TX',
    label: '624 QR ITA 1250 TX',
    mailerType: 'ITA',
    forwardsTo: '2102552855',
  },
  {
    phone10: '8883552708',
    state: 'TX',
    label: '624 QR INT 1250 TX',
    mailerType: 'INT',
    forwardsTo: '2102552855',
  },
];

export function getQuestMailDids() {
  const raw = process.env.QUESTMAIL_DID_JSON?.trim();
  if (!raw) {
    return DEFAULT_QUESTMAIL_DIDS;
  }

  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length) {
      return parsed.map((row) => ({
        phone10: normalizePhoneDigits(row.phone10 ?? row.phone ?? ''),
        state: String(row.state ?? '').trim() || null,
        label: String(row.label ?? row.name ?? 'QuestMail').trim(),
        mailerType: String(row.mailerType ?? row.mailer_type ?? '').trim() || null,
        forwardsTo: normalizePhoneDigits(row.forwardsTo ?? row.forwards_to ?? ''),
      }));
    }
  } catch {
    // fall through
  }

  return DEFAULT_QUESTMAIL_DIDS;
}

export function matchQuestMailDid(phone) {
  const phone10 = normalizePhoneDigits(phone);
  if (phone10.length !== 10) {
    return null;
  }

  for (const entry of getQuestMailDids()) {
    if (entry.phone10 === phone10) {
      return entry;
    }
  }

  return null;
}

export function isQuestMailDid(phone) {
  return Boolean(matchQuestMailDid(phone));
}

/** Landing page numbers that are QuestMail forward targets (not used for channel — inbound ads use same DIDs). */
export function getQuestMailForwardTargets() {
  const targets = new Set();
  for (const row of getQuestMailDids()) {
    if (row.forwardsTo?.length === 10) {
      targets.add(row.forwardsTo);
    }
  }
  return targets;
}
