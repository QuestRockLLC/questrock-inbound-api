const SSN_TOKEN = '[SSN REDACTED]';
const DOB_TOKEN = '[DOB REDACTED]';

const SSN_FORMATTED = /\b\d{3}[-\s]\d{2}[-\s]\d{4}\b/g;
const SSN_NINE_DIGIT = /\b\d{9}\b/g;

/** "social" alone (not social media) or "security number" near digit groups. */
const SOCIAL_CUE_WITH_NUMBER =
  /\b(?:(?:my|your|the|need(?:\s+your)?|what'?s(?:\s+your)?|give(?:\s+me)?(?:\s+your)?)\s+)?social\b(?!\s+media\b)[\s\S]{0,80}?\b(\d{3}[-\s]?\d{2}[-\s]?\d{4}|\d{9})\b/gi;

const SECURITY_NUMBER_WITH_NUMBER =
  /\bsecurity number\b[\s\S]{0,80}?\b(\d{3}[-\s]?\d{2}[-\s]?\d{4}|\d{9})\b/gi;

const SOCIAL_SECURITY_WITH_NUMBER =
  /\b(?:social(?:\s+security)?(?:\s+number)?|ssn)\b[\s\S]{0,80}?\b(\d{3}[-\s]?\d{2}[-\s]?\d{4}|\d{9})\b/gi;

const LAST_FOUR_SOCIAL =
  /\b(last\s+(?:four|4)\s+(?:digits?\s+)?(?:of\s+(?:my\s+)?)?(?:(?:social(?:\s+security)?(?:\s+number)?)|security number|social\b(?!\s+media\b)|ssn)\s*(?:is|are|:)?\s*)([\d\s\-]{3,12})/gi;

/** Audit-only cues — borrower/LO said "social" or "security number" (review even without digits). */
export const SOCIAL_CUE_MENTION =
  /\b(?:(?:my|your|the|need(?:\s+your)?|what'?s(?:\s+your)?)\s+)?social\b(?!\s+media\b)/i;
export const SECURITY_NUMBER_CUE_MENTION = /\bsecurity number\b/i;

const DOB_KEYWORD =
  /\b(?:date\s+of\s+birth|d\.?\s*o\.?\s*b\.?|born\s+on|birth\s+date|birthday)\b/i;

const DOB_AFTER_KEYWORD =
  /\b((?:date\s+of\s+birth|d\.?\s*o\.?\s*b\.?|born\s+on|birth\s+date|birthday)\s*(?:is|was|:)?\s*)([^\n]{1,60})/gi;

const DOB_NUMERIC = /\b(0?[1-9]|1[0-2])[\/\-.](0?[1-9]|[12]\d|3[01])[\/\-.](\d{2}|\d{4})\b/g;

const DOB_MONTH_NAME =
  /\b(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?\s+\d{1,2}(?:st|nd|rd|th)?,?\s+\d{2,4}\b/gi;

const SPEAKER_DATE_LINE =
  /^([^\n:]{0,60}:\s*)(\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4}|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{1,2}(?:st|nd|rd|th)?,?\s+\d{2,4}|\d{9})\s*$/gim;

/** Spanish anywhere in transcript text. */
export const SPANISH_IN_TRANSCRIPT = /\bspanish\b|español|espanol/i;

function parseYear(rawYear) {
  const value = Number(rawYear);
  if (!Number.isFinite(value)) {
    return null;
  }
  if (rawYear.length === 2) {
    return value > 30 ? 1900 + value : 2000 + value;
  }
  return value;
}

function isLikelyBirthYear(year) {
  if (!Number.isFinite(year)) {
    return false;
  }
  const currentYear = new Date().getFullYear();
  return year >= 1920 && year <= currentYear - 15;
}

function redactDigitGroups(match) {
  return match.replace(/\d{3}[-\s]?\d{2}[-\s]?\d{4}|\d{9}/g, SSN_TOKEN);
}

function redactLikelyBirthDates(text) {
  let out = text.replace(DOB_NUMERIC, (match, _month, _day, rawYear) => {
    const year = parseYear(rawYear);
    return isLikelyBirthYear(year) ? DOB_TOKEN : match;
  });

  out = out.replace(DOB_MONTH_NAME, (match) => {
    const yearMatch = match.match(/\b(\d{2}|\d{4})\b(?!.*\b\d{2,4}\b)/) || match.match(/\b(\d{2}|\d{4})\b/g);
    const rawYear = yearMatch ? yearMatch[yearMatch.length - 1] : null;
    const year = rawYear ? parseYear(String(rawYear)) : null;
    return isLikelyBirthYear(year) ? DOB_TOKEN : match;
  });

  return out;
}

function redactDateFragment(fragment) {
  let out = String(fragment ?? '');
  out = out.replace(DOB_NUMERIC, DOB_TOKEN);
  out = out.replace(DOB_MONTH_NAME, DOB_TOKEN);
  out = out.replace(SSN_NINE_DIGIT, SSN_TOKEN);
  return out;
}

function hasLikelyDob(text) {
  for (const match of text.matchAll(DOB_NUMERIC)) {
    const year = parseYear(match[3]);
    if (isLikelyBirthYear(year)) return true;
  }
  for (const match of text.matchAll(DOB_MONTH_NAME)) {
    const years = [...match[0].matchAll(/\b(\d{2}|\d{4})\b/g)].map((m) => parseYear(m[1]));
    const year = years.length ? years[years.length - 1] : null;
    if (isLikelyBirthYear(year)) return true;
  }
  return false;
}

/**
 * Detect SSN/DOB/social cues in transcript text for audits (no values returned).
 */
export function detectTranscriptPii(text) {
  const types = [];
  if (!text?.trim()) return types;

  if (SSN_FORMATTED.test(text)) types.push('SSN (formatted)');
  if (SOCIAL_CUE_WITH_NUMBER.test(text)) types.push('SSN (after "social" cue)');
  if (SECURITY_NUMBER_WITH_NUMBER.test(text)) types.push('SSN (after "security number" cue)');
  if (SOCIAL_SECURITY_WITH_NUMBER.test(text)) types.push('SSN (after social security/SSN mention)');
  if (LAST_FOUR_SOCIAL.test(text)) types.push('SSN (last four of social)');
  if (/^[^\n:]{0,60}:\s*\d{9}\s*$/im.test(text)) types.push('SSN (9-digit speaker line)');

  if (SOCIAL_CUE_MENTION.test(text)) types.push('SSN cue ("social" — review manually)');
  if (SECURITY_NUMBER_CUE_MENTION.test(text)) types.push('SSN cue ("security number" — review manually)');

  if (DOB_AFTER_KEYWORD.test(text)) {
    for (const line of text.match(DOB_AFTER_KEYWORD) ?? []) {
      const value = line.replace(DOB_AFTER_KEYWORD, '').trim();
      if (value && value !== '?' && !/^is\b/i.test(value)) {
        types.push('DOB (after keyword)');
        break;
      }
    }
  }
  if (hasLikelyDob(text)) types.push('DOB (date of birth value)');

  const speakerDate = text.match(
    /^[^\n:]{0,60}:\s*(\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4}|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{1,2}(?:st|nd|rd|th)?,?\s+\d{2,4})\s*$/im,
  );
  if (speakerDate) {
    const years = [...speakerDate[1].matchAll(/\b(\d{2}|\d{4})\b/g)].map((m) => parseYear(m[1]));
    const year = years.length ? years[years.length - 1] : null;
    if (isLikelyBirthYear(year)) types.push('DOB (speaker line answer)');
  }

  return [...new Set(types)];
}

/**
 * Remove SSN, DOB, and social-security values from call transcript text.
 * Safe to run on ingest and on read (idempotent for already-redacted text).
 */
export function redactTranscriptPii(text) {
  if (text == null || text === '') {
    return text;
  }

  if (typeof text !== 'string') {
    return text;
  }

  let out = text;

  out = out.replace(SSN_FORMATTED, SSN_TOKEN);
  out = out.replace(SOCIAL_CUE_WITH_NUMBER, redactDigitGroups);
  out = out.replace(SECURITY_NUMBER_WITH_NUMBER, redactDigitGroups);
  out = out.replace(SOCIAL_SECURITY_WITH_NUMBER, redactDigitGroups);
  out = out.replace(LAST_FOUR_SOCIAL, (_, prefix) => `${prefix}${SSN_TOKEN}`);

  out = out.replace(DOB_AFTER_KEYWORD, (match, prefix, value) => {
    const trimmed = String(value ?? '').trim();
    if (!trimmed || trimmed === '?' || /^is\b/i.test(trimmed)) {
      return match;
    }

    const redacted = redactDateFragment(trimmed);
    if (redacted !== trimmed || DOB_KEYWORD.test(trimmed)) {
      return `${prefix}${redacted}`;
    }
    return `${prefix}${DOB_TOKEN}`;
  });

  out = redactLikelyBirthDates(out);

  out = out.replace(SPEAKER_DATE_LINE, (_, prefix, value) => {
    const trimmed = String(value ?? '').trim();
    if (/^\d{9}$/.test(trimmed)) {
      return `${prefix}${SSN_TOKEN}`;
    }
    if (DOB_NUMERIC.test(trimmed) || DOB_MONTH_NAME.test(trimmed)) {
      const years = [...trimmed.matchAll(/\b(\d{2}|\d{4})\b/g)].map((m) => parseYear(m[1]));
      const year = years.length ? years[years.length - 1] : null;
      if (isLikelyBirthYear(year)) {
        return `${prefix}${DOB_TOKEN}`;
      }
    }
    return `${prefix}${trimmed}`;
  });

  return out;
}
