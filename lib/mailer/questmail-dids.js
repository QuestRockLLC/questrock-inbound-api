import { normalizePhoneDigits } from '../phone.js';

/** QuestMail callback numbers printed on weekly mail (by state). */
export const DEFAULT_QUESTMAIL_DIDS = [
  { phone10: '8662601936', state: 'GA', label: 'QuestMail GA' },
  { phone10: '8777242152', state: 'GA', label: 'QuestMail GA' },
  { phone10: '8662608397', state: 'FL', label: 'QuestMail FL' },
  { phone10: '8662250926', state: 'FL', label: 'QuestMail FL' },
  { phone10: '8772308287', state: 'TN', label: 'QuestMail TN' },
  { phone10: '8778610843', state: 'TN', label: 'QuestMail TN' },
  { phone10: '8775860275', state: 'NC', label: 'QuestMail NC' },
  { phone10: '8883552708', state: 'TX', label: 'QuestMail TX' },
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
