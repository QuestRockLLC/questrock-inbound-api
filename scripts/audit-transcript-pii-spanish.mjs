/**
 * One-off audit: transcripts with SSN/DOB and Spanish mentions.
 * Usage: node scripts/audit-transcript-pii-spanish.mjs
 */
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { detectTranscriptPii, SPANISH_IN_TRANSCRIPT } from '../lib/transcript-redact.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(__dirname, '../.env.local');
const env = Object.fromEntries(
  readFileSync(envPath, 'utf8')
    .split('\n')
    .filter((line) => line && !line.startsWith('#'))
    .map((line) => {
      const idx = line.indexOf('=');
      return [line.slice(0, idx), line.slice(idx + 1)];
    }),
);

const SUPABASE_URL = env.SUPABASE_URL.replace(/\/$/, '');
const SUPABASE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;

async function supabaseSelect(path) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Supabase ${res.status}: ${body}`);
  }
  return res.json();
}

function parseCallId(externalCallId) {
  const raw = String(externalCallId ?? '');
  return raw
    .replace(/:transcript$/, '')
    .replace(/:answered$/, '')
    .replace(/:created$/, '');
}

function normalizeLead(leads) {
  return Array.isArray(leads) ? leads[0] : leads ?? {};
}

async function fetchAllTranscripts() {
  const rows = [];
  const pageSize = 500;
  let from = 0;

  while (true) {
    const select =
      'transcript_id,external_call_id,transcript_text,timestamp,call_source,ai_status_label,fields_populated,lead_id,leads(lead_id,full_name,phone_number,shape_lead_id,reference_code,current_status_label)';
    const path =
      `transcripts?select=${encodeURIComponent(select)}` +
      '&transcript_text=not.is.null' +
      '&transcript_text=neq.' +
      '&order=timestamp.desc' +
      `&offset=${from}&limit=${pageSize}`;

    const data = await supabaseSelect(path);
    if (!data?.length) break;
    rows.push(...data);
    if (data.length < pageSize) break;
    from += pageSize;
  }

  return rows;
}

const rows = await fetchAllTranscripts();
console.error(`Scanned ${rows.length} transcript rows.`);

const piiByLead = new Map();
const spanishCalls = [];

for (const row of rows) {
  const lead = normalizeLead(row.leads);
  const text = String(row.transcript_text ?? '');
  const piiTypes = detectTranscriptPii(text);

  if (piiTypes.length) {
    const callId = parseCallId(row.external_call_id);
    const entry = {
      borrower_name: lead.full_name || 'Unknown Caller',
      phone: lead.phone_number || null,
      shape_lead_id: lead.shape_lead_id || null,
      reference_code: lead.reference_code || null,
      call_id: callId,
      transcript_id: row.transcript_id,
      call_date: row.timestamp,
      call_source: row.call_source,
      pii_types: piiTypes,
      lead_id: lead.lead_id ?? row.lead_id,
    };

    const key = String(entry.lead_id || `${entry.borrower_name}|${entry.phone}`);
    const existing = piiByLead.get(key);
    if (existing) {
      existing.calls.push(entry);
      for (const t of piiTypes) existing.pii_types.add(t);
    } else {
      piiByLead.set(key, {
        borrower_name: entry.borrower_name,
        phone: entry.phone,
        shape_lead_id: entry.shape_lead_id,
        reference_code: entry.reference_code,
        lead_id: entry.lead_id,
        pii_types: new Set(piiTypes),
        calls: [entry],
      });
    }
  }

  if (SPANISH_IN_TRANSCRIPT.test(text)) {
    spanishCalls.push({
      borrower_name: lead.full_name || 'Unknown Caller',
      phone: lead.phone_number || null,
      shape_lead_id: lead.shape_lead_id || null,
      reference_code: lead.reference_code || null,
      call_id: parseCallId(row.external_call_id),
      transcript_id: row.transcript_id,
      call_date: row.timestamp,
      call_source: row.call_source,
      ai_status_label: row.ai_status_label || null,
      lead_status: lead.current_status_label || null,
      lead_id: lead.lead_id ?? row.lead_id,
    });
  }
}

const piiPeople = [...piiByLead.values()]
  .map((person) => ({
    borrower_name: person.borrower_name,
    phone: person.phone,
    shape_lead_id: person.shape_lead_id,
    reference_code: person.reference_code,
    lead_id: person.lead_id,
    pii_types: [...person.pii_types].sort(),
    call_count: person.calls.length,
    calls: person.calls.map((c) => ({
      call_id: c.call_id,
      call_date: c.call_date,
      pii_types: c.pii_types,
      transcript_id: c.transcript_id,
    })),
  }))
  .sort((a, b) => a.borrower_name.localeCompare(b.borrower_name));

spanishCalls.sort((a, b) => a.borrower_name.localeCompare(b.borrower_name));

console.log(JSON.stringify({ pii_people: piiPeople, spanish_in_transcript: spanishCalls }, null, 2));
