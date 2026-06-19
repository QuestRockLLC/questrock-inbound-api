import { normalizePhoneDigits } from '../phone.js';

const STREET_SUFFIX =
  /\b(\d+\s+[A-Za-z][\w\s.'-]*(?:\s+(?:Trail|Drive|Dr|Street|St|Road|Rd|Lane|Ln|Court|Ct|Way|Circle|Cir|Boulevard|Blvd|Avenue|Ave|Place|Pl|Parkway|Pkwy|Highway|Hwy)\.?))\b/gi;

const STATE_MAP = {
  tennessee: 'TN',
  tn: 'TN',
  georgia: 'GA',
  ga: 'GA',
  florida: 'FL',
  fl: 'FL',
  'north carolina': 'NC',
  nc: 'NC',
  'south carolina': 'SC',
  sc: 'SC',
  texas: 'TX',
  tx: 'TX',
};

function normalizeName(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z\s]/g, '')
    .replace(/\s+/g, ' ');
}

export function extractSpokenCallbackPhones(text) {
  const raw = String(text ?? '');
  const found = new Set();

  const areaCodePattern = /(\d{3})\s*area\s*code[,\s]+(\d{3})[-\s]?(\d{4})/gi;
  let match;
  while ((match = areaCodePattern.exec(raw)) !== null) {
    found.add(`${match[1]}${match[2]}${match[3]}`);
  }

  return [...found];
}

export function extractAddressHintsFromTranscript(text) {
  const raw = String(text ?? '');
  const result = {
    street: null,
    city: null,
    state: null,
    zip: null,
  };

  const zipMatch = raw.match(/\b(\d{5})(?:-\d{4})?\b/);
  if (zipMatch) {
    result.zip = zipMatch[1];
  }

  const cityStatePattern =
    /([A-Za-z][A-Za-z\s.'-]{2,40}),\s*(Tennessee|Georgia|Florida|North Carolina|South Carolina|Texas|TN|GA|FL|NC|SC|TX)\s*,?\s*(\d{5})/gi;
  const streetWord =
    /\b(?:Trail|Drive|Dr|Street|St|Road|Rd|Lane|Ln|Court|Ct|Way|Circle|Cir|Boulevard|Blvd|Avenue|Ave|Place|Pl|Parkway|Pkwy|Highway|Hwy)\b/i;

  for (const cityStateZip of [...raw.matchAll(cityStatePattern)].reverse()) {
    let city = cityStateZip[1].trim();
    if (city.includes('.')) {
      city = city.split('.').pop().trim();
    }
    if (!city || /\d/.test(city) || streetWord.test(city)) {
      continue;
    }
    result.city = city;
    const stateKey = cityStateZip[2].trim().toLowerCase();
    result.state = STATE_MAP[stateKey] ?? cityStateZip[2].trim().toUpperCase();
    result.zip = result.zip ?? cityStateZip[3];
    break;
  }

  STREET_SUFFIX.lastIndex = 0;
  const streetMatch = STREET_SUFFIX.exec(raw);
  if (streetMatch) {
    result.street = streetMatch[1].replace(/\s+/g, ' ').trim();
  }

  return result;
}

export function extractBorrowerNameHints(text) {
  const raw = String(text ?? '');
  const names = new Set();

  const patterns = [
    /my name is\s+([A-Za-z][A-Za-z\s.'-]{1,40})/i,
    /this is\s+([A-Za-z][A-Za-z\s.'-]{1,40})/i,
    /i'm\s+([A-Za-z][A-Za-z\s.'-]{1,40})/i,
    /i am\s+([A-Za-z][A-Za-z\s.'-]{1,40})/i,
  ];

  for (const pattern of patterns) {
    const match = raw.match(pattern);
    if (match?.[1]) {
      const cleaned = match[1].split(/[,.!?]/)[0].trim();
      if (cleaned.length >= 3) {
        names.add(cleaned);
      }
    }
  }

  const spelled = raw.match(/\b([A-Za-z](?:-[A-Za-z]){2,})\b/g);
  if (spelled) {
    for (const chunk of spelled) {
      names.add(chunk.replace(/-/g, ''));
    }
  }

  const emailName = raw.match(/\b([A-Za-z]{4,})\d*\s+at\s+gmail\b/i);
  if (emailName?.[1]) {
    names.add(emailName[1]);
  }

  return [...names];
}

export function nameMatchesMailerRow(hintName, mailerRow) {
  const hint = normalizeName(hintName);
  if (!hint || hint.length < 3) return false;

  const candidates = [
    mailerRow.full_name,
    [mailerRow.first_name, mailerRow.last_name].filter(Boolean).join(' '),
    mailerRow.last_name,
  ]
    .filter(Boolean)
    .map(normalizeName);

  for (const candidate of candidates) {
    if (!candidate) continue;
    if (candidate.includes(hint) || hint.includes(candidate)) return true;
    const hintParts = hint.split(' ');
    const last = hintParts[hintParts.length - 1];
    if (last.length >= 4 && candidate.includes(last)) return true;
    if (mailerRow.last_name && normalizeName(mailerRow.last_name) === last) return true;
    if (mailerRow.last_name) {
      const lastName = normalizeName(mailerRow.last_name);
      if (lastName.length >= 4 && (hint.includes(lastName) || lastName.includes(hint))) return true;
    }
  }

  return false;
}
