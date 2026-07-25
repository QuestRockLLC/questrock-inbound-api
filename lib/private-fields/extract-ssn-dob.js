/**
 * Deterministic SSN/DOB extraction from raw transcript text.
 * Returns verification states only in audit payload — raw values for Shape write path only.
 */

const SSN_FORMATTED = /\b(\d{3})[-\s](\d{2})[-\s](\d{4})\b/;
const SSN_NINE_DIGIT = /\b(\d{3})(\d{2})(\d{4})\b/;

const SOCIAL_CUE_WITH_NUMBER =
  /\b(?:(?:my|your|the|need(?:\s+your)?|what'?s(?:\s+your)?|give(?:\s+me)?(?:\s+your)?)\s+)?social\b(?!\s+media\b)[\s\S]{0,80}?\b(\d{3}[-\s]?\d{2}[-\s]?\d{4}|\d{9})\b/i;

const SOCIAL_SECURITY_WITH_NUMBER =
  /\b(?:social(?:\s+security)?(?:\s+number)?|ssn)\b[\s\S]{0,80}?\b(\d{3}[-\s]?\d{2}[-\s]?\d{4}|\d{9})\b/i;

const LAST_FOUR_SOCIAL =
  /\b(?:last\s+(?:four|4)\s+(?:digits?\s+)?(?:of\s+(?:my\s+)?)?(?:(?:social(?:\s+security)?(?:\s+number)?)|security number|social\b(?!\s+media\b)|ssn)\s*(?:is|are|:)?\s*)([\d\s\-]{3,12})/i;

const DOB_AFTER_KEYWORD =
  /\b(?:date\s+of\s+birth|d\.?\s*o\.?\s*b\.?|born\s+on|birth\s+date|birthday)\s*(?:is|was|:)?\s*([^\n]{1,40})/i;

const DOB_NUMERIC = /\b(0?[1-9]|1[0-2])[\/\-.](0?[1-9]|[12]\d|3[01])[\/\-.](\d{2}|\d{4})\b/g;

const DOB_MONTH_NAME =
  /\b(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?\s+\d{1,2}(?:st|nd|rd|th)?,?\s+\d{2,4}\b/i;

function parseYear(rawYear) {
  const value = Number(rawYear);
  if (!Number.isFinite(value)) return null;
  if (String(rawYear).length === 2) {
    return value > 30 ? 1900 + value : 2000 + value;
  }
  return value;
}

function isLikelyBirthYear(year) {
  if (!Number.isFinite(year)) return false;
  const currentYear = new Date().getFullYear();
  return year >= 1920 && year <= currentYear - 15;
}

function normalizeSsnDigits(raw) {
  const digits = String(raw ?? '').replace(/\D/g, '');
  if (digits.length === 9) {
    return digits;
  }
  return null;
}

function formatSsnForShape(digits) {
  return `${digits.slice(0, 3)}-${digits.slice(3, 5)}-${digits.slice(5)}`;
}

function formatDobForShape(raw) {
  const trimmed = String(raw ?? '').trim();
  const numeric = trimmed.match(DOB_NUMERIC);
  if (numeric) {
    const month = numeric[1].padStart(2, '0');
    const day = numeric[2].padStart(2, '0');
    const year = parseYear(numeric[3]);
    if (isLikelyBirthYear(year)) {
      return `${month}/${day}/${year}`;
    }
  }
  const monthName = trimmed.match(DOB_MONTH_NAME);
  if (monthName) {
    return monthName[0].trim();
  }
  return null;
}

function extractSsn(text) {
  let match = text.match(SSN_FORMATTED);
  if (match) {
    const digits = `${match[1]}${match[2]}${match[3]}`;
    return { state: 'verified', digits, last_four: digits.slice(-4) };
  }

  match = text.match(SOCIAL_CUE_WITH_NUMBER) || text.match(SOCIAL_SECURITY_WITH_NUMBER);
  if (match) {
    const digits = normalizeSsnDigits(match[1]);
    if (digits) {
      return { state: 'verified', digits, last_four: digits.slice(-4) };
    }
  }

  const speakerNine = text.match(/^[^\n:]{0,60}:\s*(\d{9})\s*$/im);
  if (speakerNine) {
    const digits = speakerNine[1];
    return { state: 'verified', digits, last_four: digits.slice(-4) };
  }

  const lastFour = text.match(LAST_FOUR_SOCIAL);
  if (lastFour) {
    const four = String(lastFour[1]).replace(/\D/g, '').slice(-4);
    if (four.length === 4) {
      return { state: 'needs_verification', digits: null, last_four: four };
    }
  }

  return { state: 'not_found', digits: null, last_four: null };
}

function extractDob(text) {
  const keyword = text.match(DOB_AFTER_KEYWORD);
  if (keyword) {
    const formatted = formatDobForShape(keyword[1]);
    if (formatted) {
      return { state: 'verified', value: formatted };
    }
    if (keyword[1]?.trim() && keyword[1].trim() !== '?') {
      return { state: 'needs_verification', value: null };
    }
  }

  for (const match of text.matchAll(DOB_NUMERIC)) {
    const year = parseYear(match[3]);
    if (isLikelyBirthYear(year)) {
      const month = match[1].padStart(2, '0');
      const day = match[2].padStart(2, '0');
      return { state: 'verified', value: `${month}/${day}/${year}` };
    }
  }

  const monthName = text.match(DOB_MONTH_NAME);
  if (monthName) {
    const formatted = formatDobForShape(monthName[0]);
    if (formatted) {
      return { state: 'verified', value: formatted };
    }
  }

  return { state: 'not_found', value: null };
}

/**
 * @returns {{ ssn: object, dob: object, shapeWrite: { ssn?: string, dob?: string }, audit: object }}
 */
export function extractSsnDob(transcriptText) {
  const text = String(transcriptText ?? '');
  const ssn = extractSsn(text);
  const dob = extractDob(text);

  const shapeWrite = {};
  if (ssn.state === 'verified' && ssn.digits) {
    shapeWrite.ssn = formatSsnForShape(ssn.digits);
  }
  if (dob.state === 'verified' && dob.value) {
    shapeWrite.dob = dob.value;
  }

  const audit = {
    ssn: {
      state: ssn.state,
      last_four: ssn.last_four,
      has_full: ssn.state === 'verified',
    },
    dob: {
      state: dob.state,
      has_value: dob.state === 'verified',
    },
    extracted_at: new Date().toISOString(),
  };

  return { ssn, dob, shapeWrite, audit };
}

export function summarizePrivateIdentity(extractResult) {
  return extractResult?.audit ?? {
    ssn: { state: 'not_found', last_four: null, has_full: false },
    dob: { state: 'not_found', has_value: false },
    extracted_at: new Date().toISOString(),
  };
}
