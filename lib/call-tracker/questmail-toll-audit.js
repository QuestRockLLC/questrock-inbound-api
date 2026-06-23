import { getQuestMailDids } from '../mailer/questmail-dids.js';
import { normalizePhoneDigits, isTollFreePhone } from '../phone.js';

const TOLL_PREFIXES = ['800', '833', '844', '855', '866', '877', '888'];

function parseCallId(externalCallId) {
  const raw = String(externalCallId ?? '');
  for (const suffix of [':answered', ':transcript', ':created']) {
    if (raw.endsWith(suffix)) {
      return raw.slice(0, -suffix.length);
    }
  }
  return raw;
}

function questMailDidMap() {
  const map = new Map();
  for (const row of getQuestMailDids()) {
    map.set(row.phone10, row);
  }
  return map;
}

/** Pull toll-free 10-digit numbers from transcript text (Zoom speaker lines + spoken). */
export function extractTollNumbersFromText(text) {
  const raw = String(text ?? '');
  const found = new Set();

  const patterns = [
    /\b1?([28][0-9]{2})[-.\s]?([0-9]{3})[-.\s]?([0-9]{4})\b/g,
    /^\[[\d:.]+\]\s+(1?\d{10,11})\s*:/gm,
    /\b(8(?:00|33|44|55|66|77|88)[0-9]{7})\b/g,
  ];

  for (const pattern of patterns) {
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(raw)) !== null) {
      let phone10;
      if (match[1] && match[2] && match[3] && match[0].includes('-')) {
        phone10 = `${match[1]}${match[2]}${match[3]}`;
      } else {
        phone10 = normalizePhoneDigits(match[1] ?? match[0]);
      }
      if (phone10.length === 11 && phone10.startsWith('1')) {
        phone10 = phone10.slice(1);
      }
      if (phone10.length === 10 && isTollFreePhone(phone10)) {
        found.add(phone10);
      }
    }
  }

  return [...found];
}

function isQuestMailRow(row) {
  const meta = row.fields_populated ?? {};
  const lead = Array.isArray(row.leads) ? row.leads[0] : row.leads;
  return (
    meta.call_channel === 'questmail' ||
    lead?.lead_source === 'questmail' ||
    row.call_source === 'QuestMail' ||
    Boolean(meta.questmail_toll || meta.questmail_hold || meta.questmail_label)
  );
}

/**
 * Find QuestMail toll-free lines mentioned in transcripts Jun 16–23 that may lack a tracked call.
 */
export async function auditQuestMailTollLines(supabase, { since, until }) {
  const didMap = questMailDidMap();
  const knownToll = new Set(didMap.keys());

  const { data: rows, error } = await supabase
    .from('transcripts')
    .select(
      `
      transcript_id,
      external_call_id,
      timestamp,
      transcript_text,
      call_source,
      fields_populated,
      lead_id,
      leads ( lead_id, full_name, lead_source, reference_code )
    `,
    )
    .gte('timestamp', since)
    .lte('timestamp', until)
    .order('timestamp', { ascending: true });

  if (error) {
    throw error;
  }

  const answeredQuestMail = new Map();
  const transcriptByCall = new Map();
  const tollMentions = [];

  for (const row of rows ?? []) {
    const callId = parseCallId(row.external_call_id);
    const meta = row.fields_populated ?? {};
    const isAnswered = String(row.external_call_id ?? '').endsWith(':answered');
    const isTranscript = String(row.external_call_id ?? '').endsWith(':transcript');

    if (isTranscript) {
      transcriptByCall.set(callId, row);
    }

    const metaToll = normalizePhoneDigits(meta.questmail_toll ?? '');
    if (metaToll.length === 10 && isAnswered && isQuestMailRow(row)) {
      answeredQuestMail.set(callId, {
        call_id: callId,
        timestamp: row.timestamp,
        questmail_toll: metaToll,
        questmail_label: meta.questmail_label ?? null,
        questmail_state: meta.questmail_state ?? null,
        lead_name: row.leads?.full_name ?? null,
        reference_code: row.leads?.reference_code ?? meta.reference_code ?? null,
      });
    }

    const textTolls = extractTollNumbersFromText(row.transcript_text);
    const allTolls = new Set(textTolls);
    if (metaToll.length === 10 && isTollFreePhone(metaToll)) {
      allTolls.add(metaToll);
    }

    for (const phone10 of allTolls) {
      if (!knownToll.has(phone10)) {
        continue;
      }
      tollMentions.push({
        phone10,
        call_id: callId,
        transcript_id: row.transcript_id,
        timestamp: row.timestamp,
        external_call_id: row.external_call_id,
        is_questmail_tracked: answeredQuestMail.has(callId),
        is_questmail_row: isQuestMailRow(row),
        lead_name: row.leads?.full_name ?? null,
        snippet: String(row.transcript_text ?? '').slice(0, 120).replace(/\s+/g, ' '),
      });
    }
  }

  const byToll = new Map();
  for (const mention of tollMentions) {
    if (!byToll.has(mention.phone10)) {
      byToll.set(mention.phone10, {
        phone10: mention.phone10,
        did: didMap.get(mention.phone10) ?? null,
        mentions: [],
        tracked_call_ids: new Set(),
      });
    }
    const bucket = byToll.get(mention.phone10);
    bucket.mentions.push(mention);
    if (mention.is_questmail_tracked) {
      bucket.tracked_call_ids.add(mention.call_id);
    }
  }

  const toll_summary = [...byToll.values()].map((bucket) => ({
    phone10: bucket.phone10,
    display: formatToll(bucket.phone10),
    state: bucket.did?.state ?? null,
    label: bucket.did?.label ?? null,
    tracked_calls: [...bucket.tracked_call_ids],
    tracked_count: bucket.tracked_call_ids.size,
    mention_count: bucket.mentions.length,
    untracked_mentions: bucket.mentions.filter((m) => !m.is_questmail_tracked),
  }));

  const tracked_calls = [...answeredQuestMail.values()].sort(
    (a, b) => new Date(a.timestamp) - new Date(b.timestamp),
  );

  const potentially_missed = [];
  for (const bucket of toll_summary) {
    for (const mention of bucket.untracked_mentions) {
      potentially_missed.push({
        ...mention,
        phone10: bucket.phone10,
        display: formatToll(bucket.phone10),
        state: bucket.state,
        label: bucket.label,
      });
    }
  }

  const questmail_transcripts_without_answered = [];
  for (const [callId, row] of transcriptByCall) {
    if (answeredQuestMail.has(callId)) {
      continue;
    }
    if (!isQuestMailRow(row) && !extractTollNumbersFromText(row.transcript_text).some((t) => knownToll.has(t))) {
      continue;
    }
    questmail_transcripts_without_answered.push({
      call_id: callId,
      timestamp: row.timestamp,
      lead_name: row.leads?.full_name ?? null,
      tolls_in_text: extractTollNumbersFromText(row.transcript_text).filter((t) => knownToll.has(t)),
      has_transcript: Boolean(row.transcript_text?.trim()),
    });
  }

  return {
    since,
    until,
    known_questmail_toll_lines: [...knownToll].map((phone10) => ({
      phone10,
      display: formatToll(phone10),
      ...didMap.get(phone10),
    })),
    tracked_questmail_calls: tracked_calls,
    tracked_count: tracked_calls.length,
    toll_summary,
    potentially_missed,
    questmail_transcripts_without_answered,
    unique_toll_lines_seen: toll_summary.length,
  };
}

function formatToll(phone10) {
  const d = normalizePhoneDigits(phone10);
  if (d.length !== 10) {
    return phone10;
  }
  return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
}
