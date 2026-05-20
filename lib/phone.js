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
