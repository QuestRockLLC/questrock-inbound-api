import { formatPhoneNumber, isTollFreePhone, normalizePhoneDigits } from '../phone.js';

const PLACEHOLDER_NAMES = new Set(['questmail caller', 'wireless caller', 'unknown caller']);

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
  ];

  for (const pattern of patterns) {
    const match = raw.match(pattern);
    if (match?.[1]) {
      return titleCaseName(match[1]);
    }
  }

  return null;
}

export function extractNameFromTranscript(text) {
  const raw = String(text ?? '');
  if (!raw) {
    return null;
  }

  const patterns = [
    /\bmy name(?:'s| is)\s+([A-Z][a-z.'-]+(?:\s+[A-Z][a-z.'-]+)+)/i,
    /\bthis is\s+([A-Z][a-z.'-]+(?:\s+[A-Z][a-z.'-]+)+)/i,
    /\b([A-Z][a-z.'-]+(?:\s+[A-Z][a-z.'-]+)+),\s+I(?:'m| am) calling\b/i,
    /\b(?:Perfect|Got it|Okay),?\s+([A-Z][a-z.'-]+(?:\s+[A-Z][a-z.'-]+)+),\s+I got you\b/i,
    /\b([A-Z][a-z.'-]+(?:\s+[A-Z][a-z.'-]+)+),\s+I got you here\b/i,
  ];

  for (const pattern of patterns) {
    const match = raw.match(pattern);
    if (match?.[1]) {
      const name = titleCaseName(match[1]);
      if (name && !/^(Yes|No|Okay|Perfect|Great|Hello|Thanks)$/i.test(name)) {
        return name;
      }
    }
  }

  return null;
}

export function extractPhoneFromTranscript(text) {
  const raw = String(text ?? '');
  if (!raw) {
    return null;
  }

  const tail = raw.slice(-2500);
  const patterns = [
    /(?:phone number|callback number|text you|number real quick)[\s\S]{0,220}?(\d{3})[^\d]{0,6}(\d{3})[^\d]{0,6}(\d{4})/i,
    /(?:it's|it is|gonna be)[\s\S]{0,120}?(\d{3})[^\d]{0,6}(\d{3})[^\d]{0,6}(\d{4})/i,
  ];

  for (const pattern of patterns) {
    const match = tail.match(pattern);
    if (match) {
      const formatted = formatPhoneNumber(`${match[1]}${match[2]}${match[3]}`);
      if (formatted && !isTollFreePhone(formatted)) {
        return formatted;
      }
    }
  }

  const digitRuns = [...tail.matchAll(/(\d{3})[^\d]{0,6}(\d{3})[^\d]{0,6}(\d{4})/g)];
  for (const match of digitRuns.reverse()) {
    const formatted = formatPhoneNumber(`${match[1]}${match[2]}${match[3]}`);
    if (formatted && !isTollFreePhone(formatted)) {
      return formatted;
    }
  }

  return null;
}

function nameFromExtractedFields(call) {
  const fields = call.extracted_fields ?? [];
  const hit = fields.find((row) => /^full_name$/i.test(row.field) || /^firstname$/i.test(row.field));
  if (hit?.value) {
    return titleCaseName(hit.value);
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
    if (formatted && !isTollFreePhone(formatted)) {
      return formatted;
    }
  }

  return null;
}

export function resolveCallDisplay(call) {
  const leadName = cleanName(call.borrower_name);
  const leadPhone = call.phone || null;
  const meta = call.fields_populated ?? call.answered_meta ?? {};

  const summaryName = extractNameFromSummary(call.call_summary);
  const transcriptName = extractNameFromTranscript(call.transcript_text);
  const extractedName = nameFromExtractedFields(call);

  const candidates = [transcriptName, summaryName, extractedName].filter(Boolean);
  let displayName = candidates[0] || null;

  if (!displayName && !isPlaceholderName(leadName)) {
    displayName = titleCaseName(leadName);
  }

  if (!displayName) {
    displayName = 'Unknown caller';
  }

  const metaPhone = phoneFromMeta(meta);
  const transcriptPhone = extractPhoneFromTranscript(call.transcript_text);
  let displayPhone = metaPhone || transcriptPhone || null;

  if (!displayPhone && leadPhone && !isTollFreePhone(leadPhone)) {
    displayPhone = formatPhoneNumber(leadPhone) || leadPhone;
  }

  if (!displayPhone && isTollFreePhone(leadPhone)) {
    displayPhone = null;
  }

  const leadNameMismatch =
    Boolean(leadName) &&
    !isPlaceholderName(leadName) &&
    cleanName(displayName).toLowerCase() !== cleanName(leadName).toLowerCase();

  const nameCorrected =
    isPlaceholderName(leadName) ||
    leadNameMismatch ||
    (summaryName && cleanName(summaryName).toLowerCase() !== cleanName(leadName).toLowerCase()) ||
    (transcriptName && cleanName(transcriptName).toLowerCase() !== cleanName(leadName).toLowerCase());

  return {
    display_name: displayName,
    display_phone: displayPhone,
    lead_name: leadName || null,
    lead_phone: isTollFreePhone(leadPhone) ? null : leadPhone,
    inbound_line: isTollFreePhone(leadPhone) ? formatPhoneNumber(leadPhone) || leadPhone : null,
    name_corrected: nameCorrected,
    name_source: transcriptName
      ? 'transcript'
      : summaryName
        ? 'ai_summary'
        : extractedName
          ? 'extracted_fields'
          : 'lead_record',
    phone_source: metaPhone ? 'call_meta' : transcriptPhone ? 'transcript' : displayPhone ? 'lead_record' : null,
    phone_digits: displayPhone ? normalizePhoneDigits(displayPhone) : null,
  };
}

export function detectIntakeCompleted(text) {
  const lower = String(text ?? '').toLowerCase();
  if (!lower) {
    return false;
  }

  const collectedFacts =
    /(social|ssn|date of birth|dob|monthly income|credit score|what type of loan|current loan|mortgage payment|8\.5%|escrow)/i.test(
      lower,
    );
  const scheduledPitch =
    /(callback|follow[- ]?up call|5\s*(pm|p\.m\.)|pitch|present loan options|call you (?:back )?at)/i.test(
      lower,
    );

  return collectedFacts && scheduledPitch;
}

export function mapOpsStatusLabel(call) {
  const status = cleanName(call.ai_status_label || call.lead_status_label);
  const combined = `${call.call_summary ?? ''}\n${call.transcript_text ?? ''}`;

  if (/pitch appointment scheduled/i.test(status) && detectIntakeCompleted(combined)) {
    return 'Application completed · Pitch scheduled';
  }

  if (/first call appointment scheduled/i.test(status) && detectIntakeCompleted(combined)) {
    return 'Application completed · Pitch scheduled';
  }

  if (/long term nurture/i.test(status) && detectIntakeCompleted(combined)) {
    return 'Application completed · Pitch scheduled';
  }

  return status || 'No status yet';
}
