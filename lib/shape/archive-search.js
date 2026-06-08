import { normalizeBulkLeadRow } from './bulk-export.js';

const STALLED_STATUS_PATTERNS = [
  'did not advance',
  'long term nurture',
  'not contacted',
  'attempting to contact',
  'turndown',
  'inactive',
  'on hold',
  'stalled',
  'no contact',
  'unresponsive',
  'new lead',
];

const STALL_QUERY_PATTERN =
  /\b(stuck|stalled|stall|no movement|no progress|idle|cold|nurture|not contact|did not advance|unresponsive|follow.?up|aging|old leads?)\b/i;

function pickBulkField(lead, ...keys) {
  const raw = lead.bulk_fields ?? {};
  const normalized = normalizeBulkLeadRow(raw);
  for (const key of keys) {
    const value = normalized[key] ?? raw[key];
    if (value != null && String(value).trim() !== '') {
      return String(value).trim();
    }
  }
  return null;
}

function leadMatchesText(lead, query) {
  const q = query.toLowerCase();
  const haystack = [
    lead.full_name,
    lead.phone,
    lead.email,
    lead.lead_source,
    lead.mstrstatus1,
    lead.shape_lead_id,
    pickBulkField(lead, 'referralsource', 'Referral Source'),
    pickBulkField(lead, 'borstate', 'Present State', 'prState', 'Property State'),
    pickBulkField(lead, 'purpose', 'Purpose'),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  return haystack.includes(q) || q.split(/\s+/).some((term) => term.length > 2 && haystack.includes(term));
}

function isStalledStatus(status) {
  const normalized = String(status ?? '').trim().toLowerCase();
  if (!normalized) {
    return false;
  }
  return STALLED_STATUS_PATTERNS.some(
    (pattern) => normalized.includes(pattern) || pattern.includes(normalized),
  );
}

function scoreLead(lead, { query, preferStalled }) {
  let score = 0;
  const status = String(lead.mstrstatus1 ?? '').trim();

  if (preferStalled && isStalledStatus(status)) {
    score += 40;
  }

  if (query && leadMatchesText(lead, query)) {
    score += 30;
  }

  if (lead.notes_sidebar || lead.recent_notes) {
    score += 5;
  }

  const created = pickBulkField(lead, 'createdDate', 'Created Date');
  if (created) {
    score += 2;
  }

  return score;
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 */
export async function getLatestArchiveBatchId(supabase) {
  const { data, error } = await supabase
    .from('shape_archive_batches')
    .select('batch_id')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data?.batch_id ?? null;
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 */
export async function retrieveArchiveContext(supabase, {
  query,
  batchId,
  limit = 12,
  noteLimitPerLead = 6,
}) {
  const resolvedBatchId = batchId ?? (await getLatestArchiveBatchId(supabase));
  if (!resolvedBatchId) {
    return { batch_id: null, leads: [], total_leads: 0 };
  }

  const preferStalled = STALL_QUERY_PATTERN.test(query);

  const { data: allLeads, error: leadsError } = await supabase
    .from('shape_archive_leads')
    .select('*')
    .eq('batch_id', resolvedBatchId);

  if (leadsError) {
    throw leadsError;
  }

  const { data: noteHits, error: notesError } =
    query.trim().length >= 3
      ? await supabase
          .from('shape_archive_notes')
          .select('shape_lead_id, note_text, note_source, noted_at')
          .eq('batch_id', resolvedBatchId)
          .ilike('note_text', `%${query.replace(/[%_]/g, '')}%`)
          .limit(80)
      : { data: [], error: null };

  if (notesError) {
    throw notesError;
  }

  const noteHitIds = new Set((noteHits ?? []).map((row) => row.shape_lead_id));

  const ranked = (allLeads ?? [])
    .map((lead) => ({
      lead,
      score:
        scoreLead(lead, { query, preferStalled }) +
        (noteHitIds.has(lead.shape_lead_id) ? 25 : 0),
    }))
    .filter(({ score, lead }) => score > 0 || !query?.trim() || preferStalled)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  const selected = ranked.length
    ? ranked
    : preferStalled
      ? (allLeads ?? [])
          .filter((lead) => isStalledStatus(lead.mstrstatus1))
          .slice(0, limit)
          .map((lead) => ({ lead, score: scoreLead(lead, { query, preferStalled }) }))
      : (allLeads ?? [])
          .slice(0, limit)
          .map((lead) => ({ lead, score: scoreLead(lead, { query, preferStalled }) }));

  const shapeIds = selected.map(({ lead }) => lead.shape_lead_id);

  const { data: notes, error: allNotesError } = await supabase
    .from('shape_archive_notes')
    .select('shape_lead_id, note_text, note_source, noted_at')
    .eq('batch_id', resolvedBatchId)
    .in('shape_lead_id', shapeIds)
    .order('noted_at', { ascending: false });

  if (allNotesError) {
    throw allNotesError;
  }

  const notesByLead = new Map();
  for (const note of notes ?? []) {
    const list = notesByLead.get(note.shape_lead_id) ?? [];
    if (list.length < noteLimitPerLead) {
      list.push(note);
      notesByLead.set(note.shape_lead_id, list);
    }
  }

  const leads = selected.map(({ lead, score }) => {
    const bulk = normalizeBulkLeadRow(lead.bulk_fields ?? {});
    return {
      archive_lead_id: lead.archive_lead_id,
      shape_lead_id: lead.shape_lead_id,
      full_name: lead.full_name,
      phone: lead.phone,
      email: lead.email,
      lead_source: lead.lead_source,
      mstrstatus1: lead.mstrstatus1,
      loan_amount: pickBulkField(lead, 'LoanAmount', 'Loan Amount'),
      property_state: pickBulkField(lead, 'prState', 'Property State', 'borstate', 'Present State'),
      purpose: pickBulkField(lead, 'purpose', 'Purpose'),
      created_date: pickBulkField(lead, 'createdDate', 'Created Date'),
      last_activity: pickBulkField(lead, 'lastActivityDate', 'Last Activity Date'),
      credit_score: pickBulkField(lead, 'borcreditscore', 'Credit Score'),
      referral_source: pickBulkField(lead, 'referralsource', 'Referral Source'),
      notes_sidebar: lead.notes_sidebar,
      recent_notes: lead.recent_notes,
      relevance_score: score,
      notes: (notesByLead.get(lead.shape_lead_id) ?? []).map((note) => ({
        source: note.note_source,
        text: String(note.note_text ?? '').slice(0, 1200),
        at: note.noted_at,
      })),
      bulk_snapshot: {
        address: pickBulkField(lead, 'boraddress', 'Present Address'),
        property_address: pickBulkField(lead, 'prStreetAddress', 'Property Street Address'),
        purchase_price: pickBulkField(lead, 'borpurchasePrice', 'Purchase Price'),
      },
    };
  });

  return {
    batch_id: resolvedBatchId,
    total_leads: allLeads?.length ?? 0,
    prefer_stalled: preferStalled,
    leads,
    note_hits: noteHits?.length ?? 0,
  };
}

export function formatArchiveContextForPrompt(context) {
  if (!context.leads?.length) {
    return 'No archived leads matched this question.';
  }

  return context.leads
    .map((lead, index) => {
      const noteLines = lead.notes?.length
        ? lead.notes.map((note) => `  - [${note.source}] ${note.text}`).join('\n')
        : '  - (no notes in archive)';

      return [
        `### Lead ${index + 1}`,
        `Shape ID: ${lead.shape_lead_id}`,
        `Name: ${lead.full_name || 'Unknown'}`,
        `Source: ${lead.lead_source || '—'}`,
        `Status: ${lead.mstrstatus1 || '—'}`,
        `Phone: ${lead.phone || '—'} | Email: ${lead.email || '—'}`,
        `Created: ${lead.created_date || '—'} | Last activity: ${lead.last_activity || '—'}`,
        `Loan amount: ${lead.loan_amount || '—'} | Purpose: ${lead.purpose || '—'} | State: ${lead.property_state || '—'}`,
        `Referral: ${lead.referral_source || '—'} | Credit: ${lead.credit_score || '—'}`,
        `Notes:`,
        noteLines,
      ].join('\n');
    })
    .join('\n\n');
}
