const US_STATE_NAME_TO_ABBR = {
  alabama: 'AL',
  alaska: 'AK',
  arizona: 'AZ',
  arkansas: 'AR',
  california: 'CA',
  colorado: 'CO',
  connecticut: 'CT',
  delaware: 'DE',
  'district of columbia': 'DC',
  florida: 'FL',
  georgia: 'GA',
  hawaii: 'HI',
  idaho: 'ID',
  illinois: 'IL',
  indiana: 'IN',
  iowa: 'IA',
  kansas: 'KS',
  kentucky: 'KY',
  louisiana: 'LA',
  maine: 'ME',
  maryland: 'MD',
  massachusetts: 'MA',
  michigan: 'MI',
  minnesota: 'MN',
  mississippi: 'MS',
  missouri: 'MO',
  montana: 'MT',
  nebraska: 'NE',
  nevada: 'NV',
  'new hampshire': 'NH',
  'new jersey': 'NJ',
  'new mexico': 'NM',
  'new york': 'NY',
  'north carolina': 'NC',
  'north dakota': 'ND',
  ohio: 'OH',
  oklahoma: 'OK',
  oregon: 'OR',
  pennsylvania: 'PA',
  'rhode island': 'RI',
  'south carolina': 'SC',
  'south dakota': 'SD',
  tennessee: 'TN',
  texas: 'TX',
  utah: 'UT',
  vermont: 'VT',
  virginia: 'VA',
  washington: 'WA',
  'west virginia': 'WV',
  wisconsin: 'WI',
  wyoming: 'WY',
};

const MONEY_LIKE_FIELDS = new Set(['LoanAmount', 'qkappestAppraisalVal']);

function normalizeUsPhoneToE164(raw) {
  const digits = String(raw ?? '').replace(/\D/g, '');
  let normalized = digits;

  if (normalized.length === 11 && normalized.startsWith('1')) {
    normalized = normalized.slice(1);
  }

  if (normalized.length === 10) {
    return `+1${normalized}`;
  }

  return String(raw ?? '').trim();
}

function normalizeUsStateAbbrev(raw) {
  const value = String(raw ?? '').trim();
  if (!value) {
    return value;
  }

  if (/^[A-Za-z]{2}$/.test(value)) {
    return value.toUpperCase();
  }

  const key = value.toLowerCase().replace(/\./g, '').replace(/\s+/g, ' ').trim();
  return US_STATE_NAME_TO_ABBR[key] || value;
}

function normalizePlainAmount(raw) {
  const stripped = String(raw ?? '').trim().replace(/[$,\s]/g, '');
  if (/^\d+(\.\d+)?$/.test(stripped)) {
    return stripped;
  }

  return String(raw ?? '').trim();
}

export function normalizeShapeFieldValue(field, value) {
  let output = String(value ?? '').trim();
  if (!output) {
    return output;
  }

  if (field === 'phone' || /phone/i.test(field)) {
    return normalizeUsPhoneToE164(output);
  }

  if (field === 'borstate' || field === 'prState') {
    return normalizeUsStateAbbrev(output);
  }

  if (MONEY_LIKE_FIELDS.has(field)) {
    return normalizePlainAmount(output);
  }

  if (field === 'prCountry' && /united states|usa|u\.s\./i.test(output)) {
    return 'United States';
  }

  return output;
}

export function isEmptyShapeValue(value) {
  return value === null || value === undefined || String(value).trim() === '';
}

/**
 * Applies overwrite rules before sending fields to Shape.
 */
export function mergeFieldsForShapeUpdate({
  extractedFields,
  existingShapeLead = {},
  minConfidence = 0.55,
}) {
  const toApply = {};

  for (const row of extractedFields) {
    const field = String(row.field ?? '').trim();
    const value = normalizeShapeFieldValue(field, row.value);
    const confidence = Number(row.confidence ?? 0);

    if (!field || !value || confidence < minConfidence) {
      continue;
    }

    const existing = existingShapeLead[field];
    const shouldOverwrite =
      row.overwrite === true ||
      isEmptyShapeValue(existing) ||
      String(existing).trim().toLowerCase() === String(value).trim().toLowerCase();

    if (shouldOverwrite) {
      toApply[field] = value;
    }
  }

  return toApply;
}
