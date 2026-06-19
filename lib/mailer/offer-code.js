const OFFER_CODE_PATTERNS = [
  /offer\s+code\s+is[:\s#-]*([A-Z0-9]{4,14})/gi,
  /offer\s+code[:\s#-]+([A-Z0-9]{4,14})/gi,
  /reference\s+code[:\s#-]*([A-Z0-9]{4,14})/gi,
  /referral\s+(?:number|code)[:\s#-]*([A-Z0-9]{4,14})/gi,
  /code\s+on\s+(?:the\s+)?(?:letter|mailer|mail)[:\s#-]*([A-Z0-9]{4,14})/gi,
  /reference\s+number[:\s#-]*([A-Z0-9]{4,14})/gi,
  /\bcode\s+is[:\s#-]*([A-Z0-9]{4,14})/gi,
];

const MAILER_LANGUAGE =
  /\b(got your letter|letter in the mail|in the mail|mailer|offer code|reference code|referral number|questmail|quest mail|improve my loan)\b/i;

/** NATO / spoken letter names → single letter (QuestMail codes like 624C01194). */
const PHONETIC_LETTERS = {
  alpha: 'A',
  bravo: 'B',
  charlie: 'C',
  delta: 'D',
  echo: 'E',
  foxtrot: 'F',
  golf: 'G',
  hotel: 'H',
  india: 'I',
  juliet: 'J',
  kilo: 'K',
  lima: 'L',
  mike: 'M',
  november: 'N',
  oscar: 'O',
  papa: 'P',
  quebec: 'Q',
  romeo: 'R',
  sierra: 'S',
  tango: 'T',
  uniform: 'U',
  victor: 'V',
  whiskey: 'W',
  xray: 'X',
  yankee: 'Y',
  zulu: 'Z',
};

const TOLL_FREE_PREFIXES = new Set(['800', '833', '844', '855', '866', '877', '888']);

function normalizeCodeToken(value) {
  return String(value ?? '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

function replacePhoneticAlphabet(text) {
  let result = String(text ?? '');
  for (const [word, letter] of Object.entries(PHONETIC_LETTERS)) {
    result = result.replace(new RegExp(`\\bin\\s+${word}\\b`, 'gi'), ` ${letter} `);
    result = result.replace(new RegExp(`\\b${word}\\b`, 'gi'), ` ${letter} `);
  }
  return result;
}

/**
 * Parse spoken QuestMail codes, e.g. "624c in Charlie, 011… 94" → 624C01194.
 */
export function extractSpokenQuestMailCodes(text) {
  const found = new Set();
  const raw = String(text ?? '');

  const spokenPattern =
    /624\s*([a-zA-Z])(?:\s+in\s+[a-zA-Z]+)?\s*[,:]?\s*([0-9][0-9\s…\-,]{0,8}\d)/gi;
  let spokenMatch;
  while ((spokenMatch = spokenPattern.exec(raw)) !== null) {
    const letter = spokenMatch[1].toUpperCase();
    const digits = spokenMatch[2].replace(/\D/g, '').slice(0, 6);
    if (letter && digits.length >= 2) {
      found.add(`624${letter}${digits}`);
    }
  }

  const normalized = replacePhoneticAlphabet(raw);
  const compact = normalized.replace(/[^A-Za-z0-9]/g, '').toUpperCase();

  for (const match of compact.matchAll(/624[A-Z]?\d{4,8}/g)) {
    const code = match[0].replace(/^624([A-Z])\1/, '624$1');
    found.add(code);
  }

  return [...found];
}

/**
 * Borrower callback numbers from transcript (exclude toll-free / Zoom lines).
 */
export function extractPhoneCandidatesFromTranscript(text) {
  const raw = String(text ?? '');
  const found = new Set();
  const pattern = /\b(\d{3})[-.\s]?(\d{3})[-.\s]?(\d{4})\b/g;

  let match;
  while ((match = pattern.exec(raw)) !== null) {
    const phone10 = `${match[1]}${match[2]}${match[3]}`;
    if (TOLL_FREE_PREFIXES.has(phone10.slice(0, 3))) {
      continue;
    }
    found.add(phone10);
  }

  const compactPattern = /(?:^|[\s\]])((?:1)?\d{10})(?:[\s:]|$)/gm;
  while ((match = compactPattern.exec(raw)) !== null) {
    let phone10 = match[1].replace(/\D/g, '');
    if (phone10.length === 11 && phone10.startsWith('1')) {
      phone10 = phone10.slice(1);
    }
    if (phone10.length === 10 && !TOLL_FREE_PREFIXES.has(phone10.slice(0, 3))) {
      found.add(phone10);
    }
  }

  return [...found];
}

export function transcriptMentionsMailer(text) {
  return MAILER_LANGUAGE.test(String(text ?? ''));
}

export function extractOfferCodeCandidates(text) {
  const raw = String(text ?? '');
  const found = new Set();

  for (const pattern of OFFER_CODE_PATTERNS) {
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(raw)) !== null) {
      const code = normalizeCodeToken(match[1]);
      if (code.length >= 4 && code.length <= 14) {
        found.add(code);
      }
    }
  }

  for (const code of extractSpokenQuestMailCodes(raw)) {
    const normalizedCode = code.replace(/^624([A-Z])\1+/i, '624$1');
    if (normalizedCode.length >= 4 && normalizedCode.length <= 14) {
      found.add(normalizedCode);
    }
  }

  const referenceSpoken = replacePhoneticAlphabet(raw).replace(/[^A-Za-z0-9\s]/g, ' ');
  for (const match of referenceSpoken.matchAll(/\b([A-Z]\d{4,8})\b/g)) {
    found.add(normalizeCodeToken(match[1]));
  }

  const compact = replacePhoneticAlphabet(raw).replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  for (const match of compact.matchAll(/624[A-Z0-9]{5,10}/g)) {
    const code = match[0].replace(/^624([A-Z])\1+/i, '624$1');
    found.add(code);
  }

  return [...found]
    .map((code) => code.replace(/^624([A-Z])\1+/i, '624$1'))
    .filter((code) => {
      if (code.startsWith('624') && code.length < 8) return false;
      return code.length >= 4 && code.length <= 14;
    })
    .sort((a, b) => b.length - a.length);
}
