const OFFER_CODE_PATTERNS = [
  /offer\s+code[:\s#-]*([A-Z0-9]{4,14})/gi,
  /reference\s+code[:\s#-]*([A-Z0-9]{4,14})/gi,
  /code\s+on\s+(?:the\s+)?(?:letter|mailer|mail)[:\s#-]*([A-Z0-9]{4,14})/gi,
  /(?:my|the)\s+code\s+is[:\s#-]*([A-Z0-9]{4,14})/gi,
  /code[:\s#-]+([A-Z0-9]{5,14})/gi,
];

const MAILER_LANGUAGE = /\b(got your letter|in the mail|mailer|offer code|reference code|questmail|quest mail)\b/i;

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
      const code = String(match[1] ?? '')
        .trim()
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, '');
      if (code.length >= 4 && code.length <= 14) {
        found.add(code);
      }
    }
  }

  return [...found];
}
