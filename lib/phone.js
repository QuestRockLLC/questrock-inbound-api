/**
 * Strips non-digit characters and keeps the last 10 digits for US numbers.
 */
export function normalizePhoneDigits(phone) {
  const digits = String(phone ?? '').replace(/\D/g, '');

  if (digits.length === 11 && digits.startsWith('1')) {
    return digits.slice(1);
  }

  if (digits.length >= 10) {
    return digits.slice(-10);
  }

  return digits;
}

/**
 * Formats a phone number into standard US format: (XXX) XXX-XXXX.
 * Returns null when fewer than 10 digits are available.
 */
export function formatPhoneNumber(phone) {
  const digits = normalizePhoneDigits(phone);

  if (digits.length !== 10) {
    return null;
  }

  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
}

const TOLL_FREE_PREFIXES = new Set(['800', '833', '844', '855', '866', '877', '888']);

/** True when caller ID is a toll-free number (QuestMail letter lines), not the borrower cell. */
export function isTollFreePhone(phone) {
  const digits = normalizePhoneDigits(phone);
  return digits.length === 10 && TOLL_FREE_PREFIXES.has(digits.slice(0, 3));
}

/** Borrower phone usable at call-answer (not toll-free). */
export function borrowerPhoneFromCallerId(phone) {
  if (!phone || isTollFreePhone(phone)) {
    return null;
  }
  return formatPhoneNumber(phone);
}
