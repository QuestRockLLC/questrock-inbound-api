import { formatPhoneNumber, isTollFreePhone, normalizePhoneDigits } from '../phone.js';
import { getInboundLoRoster } from '../shape/inbound-lo-roster.js';
import { verifyAiStatusAgainstTranscript } from './verify-transcript-status.js';

const PLACEHOLDER_NAMES = new Set(['questmail caller', 'wireless caller', 'unknown caller']);

const COMPANY_NAME_FRAGMENTS = /\b(quest\s*rock|questrog|quest rock home loans)\b/i;

function cleanName(value) {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim();
}

function titleCaseName(value) {
  const raw = cleanName(value);
  if (!raw) {
    return null;
  }

  return raw
    .split(/\s+/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ');
}

function loNameBlocklist() {
  const names = new Set([
    'quest rock',
    'questrock',
    'questrog',
    'wireless caller',
    'nick smith',
    'nikkolas smith',
    'nikk smith',
    'concierge',
  ]);

  for (const entry of getInboundLoRoster()) {
    for (const name of entry.names ?? []) {
      names.add(String(name).trim().toLowerCase());
    }
    if (entry.displayName) {
      names.add(String(entry.displayName).trim().toLowerCase());
    }
  }

  return names;
}

function isPlaceholderName(name) {
  const normalized = cleanName(name).toLowerCase();
  if (!normalized || PLACEHOLDER_NAMES.has(normalized)) {
    return true;
  }

  if (/^questmail\b/i.test(normalized) || /^wireless\b/i.test(normalized)) {
    return true;
  }

  return false;
}

export function isInvalidBorrowerName(name) {
  const raw = cleanName(name);
  if (!raw || isPlaceholderName(raw)) {
    return true;
  }

  const normalized = raw.toLowerCase();
  const words = normalized.split(/\s+/);

  if (COMPANY_NAME_FRAGMENTS.test(normalized)) {
    return true;
  }

  if (words.length > 4) {
    return true;
  }

  if (/[.!?]/.test(raw) && words.length > 2) {
    return true;
  }

  if (/\b(i'm|i am|actually|company|avp|loan officer|thanks for calling|this is)\b/i.test(normalized)) {
    return true;
  }

  const blocked = loNameBlocklist();
  if (blocked.has(normalized)) {
    return true;
  }

  for (const blockedName of blocked) {
    if (normalized === blockedName || normalized.startsWith(`${blockedName} `)) {
      return true;
    }
  }

  if (/^(yes|no|okay|perfect|great|hello|thanks|alright)$/i.test(normalized)) {
    return true;
  }

  return false;
}

export function extractNameFromSummary(text) {
  const raw = String(text ?? '').trim();
  if (!raw) {
    return null;
  }

  const patterns = [
    /^([A-Z][a-z.'-]+(?:\s+[A-Z][a-z.'-]+)+)\s+called\b/i,
    /^The borrower,?\s+([A-Z][a-z.'-]+(?:\s+[A-Z][a-z.'-]+)+),/i,
    /\b(?:borrower|caller),?\s+([A-Z][a-z.'-]+(?:\s+[A-Z][a-z.'-]+)+),?\s+(?:called|reached|inquired)/i,
    /\bidentified as\s+([A-Z][a-z.'-]+(?:\s+[A-Z][a-z.'-]+)+)\b/i,
    /\b([A-Z][a-z.'-]+(?:\s+[A-Z][a-z.'-]+)+)\s+called\s+QuestRock/i,
    /\b([A-Z][a-z.'-]+(?:\s+[A-Z][a-z.'-]+)+)\s+called\s+Quest\s*Rock/i,
  ];

  for (const pattern of patterns) {
    const match = raw.match(pattern);
    if (match?.[1]) {
      const name = titleCaseName(match[1]);
      if (name && !isInvalidBorrowerName(name)) {
        return name;
      }
    }
  }

  return null;
}

export function extractNameFromTranscript(text) {
  const raw = String(text ?? '');
  if (!raw) {
    return null;
  }

  const borrowerOnlyPatterns = [
    /\bmy name(?:'s| is)\s+([A-Z][a-z.'-]+(?:\s+[A-Z][a-z.'-]+){0,2})/i,
    /\bwho am i speaking with\?*\s*\n[^\n]*\n([A-Za-z][a-z.'-]+(?:\s+[A-Za-z][a-z.'-]+){0,2})/i,
    /\b([A-Z][a-z.'-]+(?:\s+[A-Z][a-z.'-]+){0,2}),\s+I(?:'m| am) calling\b/i,
    /\b(?:Perfect|Got it|Okay),?\s+([A-Z][a-z.'-]+(?:\s+[A-Z][a-z.'-]+){0,2}),\s+I got you\b/i,
    /\b([A-Z][a-z.'-]+(?:\s+[A-Z][a-z.'-]+){0,2}),\s+I got you here\b/i,
  ];

  for (const pattern of borrowerOnlyPatterns) {
    const match = raw.match(pattern);
    if (match?.[1]) {
      const name = titleCaseName(match[1]);
      if (name && !isInvalidBorrowerName(name)) {
        return name;
      }
    }
  }

  return null;
}

function stripZoomSpeakerNoise(text) {
  return String(text ?? '')
    .replace(/^\[[\d:.]+\]\s+\d{10,}:\s*"?/gm, '')
    .replace(/^\[[\d:.]+\]\s+[A-Za-z][^:\n]{0,60}:\s*"?/gm, '');
}

export function isValidCallbackPhone(formatted) {
  const digits = normalizePhoneDigits(formatted);
  if (digits.length !== 10) {
    return false;
  }

  if (isTollFreePhone(formatted)) {
    return false;
  }

  const area = digits.slice(0, 3);
  const exchange = digits.slice(3, 6);

  if (area[0] === '0' || area[0] === '1' || exchange[0] === '0' || exchange[0] === '1') {
    return false;
  }

  if (exchange === '188' || exchange === '835' || area === '888') {
    return false;
  }

  const tollFragments = ['800', '833', '844', '855', '866', '877', '888'];
  if (tollFragments.some((prefix) => digits.includes(prefix) && isTollFreePhone(digits))) {
    return false;
  }

  return true;
}

export function extractPhoneFromTranscript(text) {
  const raw = stripZoomSpeakerNoise(String(text ?? ''));
  if (!raw) {
    return null;
  }

  const tail = raw.slice(-3000);
  const contextualPatterns = [
    /(?:phone number|callback number|text you(?: over)?|number real quick|read me your)[\s\S]{0,280}?(\d{3})[^\d]{0,8}(\d{3})[^\d]{0,8}(\d{4})/i,
    /(?:it's|it is|gonna be|alright,?\s*it's)[\s\S]{0,160}?(\d{3})[^\d]{0,8}(\d{3})[^\d]{0,8}(\d{4})/i,
  ];

  for (const pattern of contextualPatterns) {
    const match = tail.match(pattern);
    if (match) {
      const formatted = formatPhoneNumber(`${match[1]}${match[2]}${match[3]}`);
      if (formatted && isValidCallbackPhone(formatted)) {
        return formatted;
      }
    }
  }

  return null;
}

function nameFromExtractedFields(call) {
  const fields = call.extracted_fields ?? [];
  const hit = fields.find((row) => /^full_name$/i.test(row.field) || /^firstname$/i.test(row.field));
  if (hit?.value) {
    const name = titleCaseName(hit.value);
    if (name && !isInvalidBorrowerName(name)) {
      return name;
    }
  }
  return null;
}

function phoneFromMeta(meta = {}) {
  const candidates = [
    meta.callback_phone,
    meta.borrower_phone,
    meta.caller_phone,
    meta.borrower_phone_display,
  ];

  for (const value of candidates) {
    const formatted = formatPhoneNumber(value);
    if (formatted && isValidCallbackPhone(formatted)) {
      return formatted;
    }
  }

  return null;
}

export function resolveCallDisplay(call) {
  const leadName = cleanName(call.lead_record_name ?? call.borrower_name);
  const leadPhone = call.lead_record_phone ?? call.phone ?? null;
  const meta = call.fields_populated ?? call.answered_meta ?? {};
  const overrideName = cleanName(meta.display_name_override);

  if (overrideName) {
    const displayPhone =
      phoneFromMeta(meta) ||
      extractPhoneFromTranscript(call.transcript_text) ||
      (leadPhone && isValidCallbackPhone(leadPhone) ? formatPhoneNumber(leadPhone) || leadPhone : null);

    return {
      display_name: titleCaseName(overrideName) || overrideName,
      display_phone: displayPhone,
      lead_name: leadName || null,
      lead_phone: isTollFreePhone(leadPhone) ? null : leadPhone,
      inbound_line: isTollFreePhone(leadPhone) ? formatPhoneNumber(leadPhone) || leadPhone : null,
      name_corrected: true,
      name_source: 'manual_override',
      phone_source: displayPhone ? 'lead_record' : null,
      phone_digits: displayPhone ? normalizePhoneDigits(displayPhone) : null,
    };
  }

  const summaryName = extractNameFromSummary(call.call_summary);
  const transcriptName = extractNameFromTranscript(call.transcript_text);
  const extractedName = nameFromExtractedFields(call);

  const candidates = [summaryName, extractedName, transcriptName].filter(Boolean);
  let displayName = candidates[0] || null;

  if (!displayName && !isInvalidBorrowerName(leadName)) {
    displayName = titleCaseName(leadName);
  }

  if (!displayName || isInvalidBorrowerName(displayName)) {
    displayName = 'Unknown caller';
  }

  const metaPhone = phoneFromMeta(meta);
  const transcriptPhone = extractPhoneFromTranscript(call.transcript_text);
  let displayPhone = metaPhone || transcriptPhone || null;

  if (!displayPhone && leadPhone && isValidCallbackPhone(leadPhone)) {
    displayPhone = formatPhoneNumber(leadPhone) || leadPhone;
  }

  const inboundLine = isTollFreePhone(leadPhone) ? formatPhoneNumber(leadPhone) || leadPhone : null;

  const leadNameMismatch =
    Boolean(leadName) &&
    !isInvalidBorrowerName(leadName) &&
    cleanName(displayName).toLowerCase() !== cleanName(leadName).toLowerCase();

  const nameCorrected =
    isInvalidBorrowerName(leadName) ||
    leadNameMismatch ||
    (summaryName && cleanName(summaryName).toLowerCase() !== cleanName(leadName).toLowerCase());

  return {
    display_name: displayName,
    display_phone: displayPhone,
    lead_name: leadName || null,
    lead_phone: isTollFreePhone(leadPhone) ? null : leadPhone,
    inbound_line: inboundLine,
    name_corrected: nameCorrected,
    name_source: summaryName
      ? 'ai_summary'
      : extractedName
        ? 'extracted_fields'
        : transcriptName
          ? 'transcript'
          : 'lead_record',
    phone_source: metaPhone ? 'call_meta' : transcriptPhone ? 'transcript' : displayPhone ? 'lead_record' : null,
    phone_digits: displayPhone ? normalizePhoneDigits(displayPhone) : null,
  };
}

export function detectIntakeFactsCollected(text) {
  const lower = String(text ?? '').toLowerCase();
  if (!lower) {
    return false;
  }

  return /(social|ssn|date of birth|dob|monthly income|credit score|what type of loan|current loan|mortgage payment|8\.5%|escrow)/i.test(
    lower,
  );
}

/** Explicit pitch follow-up — present loan options, not a generic callback. */
export function detectExplicitPitchScheduled(text) {
  const lower = String(text ?? '').toLowerCase();
  if (!lower) {
    return false;
  }

  return /(pitch appointment|present loan options|pitch call|scheduled pitch|pitch scheduled|loan options on (?:the |our )?(?:next|follow[- ]?up))/i.test(
    lower,
  );
}

/** Generic callback / follow-up time — intake may be done but no pitch booked. */
export function detectCallbackScheduled(text) {
  const lower = String(text ?? '').toLowerCase();
  if (!lower || detectExplicitPitchScheduled(text)) {
    return false;
  }

  return /(callback|follow[- ]?up call|call you (?:back )?(?:at|on|between)|talk (?:to|with) you (?:tomorrow|at|on|between)|scheduled (?:for|at)|between \d|5\s*(?:pm|p\.m\.))/i.test(
    lower,
  );
}

export function detectIntakeCompleted(text) {
  return (
    detectIntakeFactsCollected(text) &&
    (detectExplicitPitchScheduled(text) || detectCallbackScheduled(text))
  );
}

export function mapOpsStatusLabel(call) {
  const verification = verifyAiStatusAgainstTranscript({
    aiStatusLabel: call.ai_status_label || call.lead_status_label,
    transcriptText: call.transcript_text,
    callSummary: call.call_summary,
  });

  return verification.report_status;
}
