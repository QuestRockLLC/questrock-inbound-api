import { fetchShapeLeadDetails } from '../shape/client.js';
import { DEFAULT_BULK_EXPORT_FIELDS, fetchShapeBulkExportPage, normalizeBulkLeadRow } from '../shape/bulk-export.js';

export const DEFAULT_ARCHIVE_SOURCES = [
  'Inbound Zoom Call',
  'Inbound Shape Phone',
  'Inbound Shape Call',
];

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function normalizeSourceLabel(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function resolveLeadSourceLabel(lead) {
  const raw =
    lead.leadsource ??
    lead.lead_source ??
    lead.LeadSource ??
    lead.leadSource ??
    lead.Source ??
    lead.source ??
    '';

  if (typeof raw === 'object' && raw !== null) {
    return String(raw.name ?? raw.label ?? raw.value ?? '').trim();
  }

  return String(raw).trim();
}

export function leadMatchesSourceFilters(lead, sourceFilters) {
  if (!sourceFilters?.length) {
    return true;
  }

  const leadSource = normalizeSourceLabel(resolveLeadSourceLabel(lead));
  if (!leadSource) {
    return false;
  }

  return sourceFilters.some((filter) => {
    const normalized = normalizeSourceLabel(filter);
    return (
      leadSource === normalized ||
      leadSource.includes(normalized) ||
      normalized.includes(leadSource)
    );
  });
}

function buildFullName(lead) {
  const first = String(lead.firstname ?? lead.first_name ?? lead['First Name'] ?? '').trim();
  const last = String(lead.lastname ?? lead.last_name ?? lead['Last Name'] ?? '').trim();
  const combined = `${first} ${last}`.trim();
  return combined || String(lead.full_name ?? lead.fullname ?? '').trim() || null;
}

function stripHtml(value) {
  return String(value ?? '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .trim();
}

export function parseNotesSidebar(html) {
  const plain = stripHtml(html);
  if (!plain) {
    return [];
  }

  return plain
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function noteRowsFromLead(batchId, archiveLeadId, shapeLeadId, leadId, lead) {
  const rows = [];
  const now = new Date().toISOString();
  const normalized = normalizeBulkLeadRow(lead);

  const sidebar = String(normalized.notes_sidebar ?? '').trim();
  if (sidebar) {
    for (const [index, noteText] of parseNotesSidebar(sidebar).entries()) {
      rows.push({
        batch_id: batchId,
        archive_lead_id: archiveLeadId,
        shape_lead_id: shapeLeadId,
        lead_id: leadId,
        note_source: 'shape_sidebar',
        note_text: noteText,
        note_html: sidebar,
        external_id: `shape-sidebar:${shapeLeadId}:${index}`,
        metadata: { segment_index: index },
        noted_at: now,
      });
    }
  }

  const aiNote = String(normalized.notes_sidebar_ai_note ?? '').trim();
  if (aiNote) {
    rows.push({
      batch_id: batchId,
      archive_lead_id: archiveLeadId,
      shape_lead_id: shapeLeadId,
      lead_id: leadId,
      note_source: 'shape_ai_note',
      note_text: stripHtml(aiNote),
      note_html: aiNote,
      external_id: `shape-ai-note:${shapeLeadId}`,
      metadata: {},
      noted_at: now,
    });
  }

  const recent = String(normalized.recent_notes ?? '').trim();
  if (recent) {
    rows.push({
      batch_id: batchId,
      archive_lead_id: archiveLeadId,
      shape_lead_id: shapeLeadId,
      lead_id: leadId,
      note_source: 'shape_recent',
      note_text: stripHtml(recent),
      note_html: null,
      external_id: `shape-recent:${shapeLeadId}`,
      metadata: {},
      noted_at: now,
    });
  }

  return rows;
}

async function insertArchiveNotes(supabase, noteRows) {
  if (!noteRows.length) {
    return 0;
  }

  let inserted = 0;
  for (const row of noteRows) {
    const { error: insertError } = await supabase.from('shape_archive_notes').insert(row);
    if (!insertError) {
      inserted += 1;
      continue;
    }
    if (insertError.code !== '23505') {
      throw insertError;
    }
  }

  return inserted;
}

async function persistLeadNotes(supabase, batchId, archiveLead, leadId, leadPayload, {
  includeTranscripts = true,
} = {}) {
  const noteRows = noteRowsFromLead(
    batchId,
    archiveLead.archive_lead_id,
    archiveLead.shape_lead_id,
    leadId,
    leadPayload,
  );

  let inserted = await insertArchiveNotes(supabase, noteRows);
  if (includeTranscripts && leadId) {
    inserted += await importTranscriptNotes(supabase, batchId, archiveLead, leadId);
  }
  return inserted;
}

/**
 * Import notes from bulk_fields (+ Supabase transcripts) without Shape search API.
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 */
export async function runImportNotesFromBulkChunk(supabase, batchId, {
  maxLeads = 40,
  includeTranscripts = false,
} = {}) {
  const batch = await getArchiveBatch(supabase, batchId);
  if (!batch) {
    const error = new Error('Archive batch not found.');
    error.statusCode = 404;
    throw error;
  }

  const { data: leads, error: leadsError } = await supabase
    .from('shape_archive_leads')
    .select('*')
    .eq('batch_id', batchId)
    .in('enrich_status', ['pending', 'failed'])
    .order('archived_at', { ascending: true })
    .limit(maxLeads);

  if (leadsError) {
    throw leadsError;
  }

  if (!leads?.length) {
    const { count: noteCount } = await supabase
      .from('shape_archive_notes')
      .select('*', { count: 'exact', head: true })
      .eq('batch_id', batchId);

    await supabase
      .from('shape_archive_batches')
      .update({
        status: 'completed',
        notes_count: noteCount ?? batch.notes_count ?? 0,
        completed_at: new Date().toISOString(),
      })
      .eq('batch_id', batchId);

    return {
      batch_id: batchId,
      phase: 'import_notes',
      processed: 0,
      notes_added: 0,
      has_more: false,
      status: 'completed',
    };
  }

  let processed = 0;
  let notesAdded = 0;

  for (const archiveLead of leads) {
    const leadPayload = normalizeBulkLeadRow(archiveLead.bulk_fields ?? {});
    const leadId =
      archiveLead.lead_id ?? (await linkSupabaseLeadId(supabase, archiveLead.shape_lead_id));

    notesAdded += await persistLeadNotes(
      supabase,
      batchId,
      archiveLead,
      leadId,
      leadPayload,
      { includeTranscripts },
    );

    await supabase
      .from('shape_archive_leads')
      .update({
        lead_id: leadId,
        notes_sidebar: leadPayload.notes_sidebar ?? archiveLead.notes_sidebar ?? null,
        notes_sidebar_ai_note:
          leadPayload.notes_sidebar_ai_note ?? archiveLead.notes_sidebar_ai_note ?? null,
        recent_notes: leadPayload.recent_notes ?? archiveLead.recent_notes ?? null,
        enrich_status: 'done',
        enrich_error: null,
        enriched_at: new Date().toISOString(),
      })
      .eq('archive_lead_id', archiveLead.archive_lead_id);

    processed += 1;
  }

  const { count: remaining } = await supabase
    .from('shape_archive_leads')
    .select('*', { count: 'exact', head: true })
    .eq('batch_id', batchId)
    .in('enrich_status', ['pending', 'failed']);

  const { count: noteCount } = await supabase
    .from('shape_archive_notes')
    .select('*', { count: 'exact', head: true })
    .eq('batch_id', batchId);

  const hasMore = (remaining ?? 0) > 0;

  await supabase
    .from('shape_archive_batches')
    .update({
      status: hasMore ? 'enrich_running' : 'completed',
      enrich_done: (batch.enrich_done ?? 0) + processed,
      enrich_failed: 0,
      notes_count: noteCount ?? 0,
      completed_at: hasMore ? null : new Date().toISOString(),
    })
    .eq('batch_id', batchId);

  return {
    batch_id: batchId,
    phase: 'import_notes',
    processed,
    notes_added: notesAdded,
    notes_count: noteCount ?? 0,
    has_more: hasMore,
    status: hasMore ? 'enrich_running' : 'completed',
  };
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 */
export async function createArchiveBatch(supabase, {
  batchLabel,
  dateFrom,
  dateTo,
  sourceFilters = DEFAULT_ARCHIVE_SOURCES,
  fields = DEFAULT_BULK_EXPORT_FIELDS,
}) {
  const { data, error } = await supabase
    .from('shape_archive_batches')
    .insert({
      batch_label: batchLabel || `Shape archive ${dateFrom} → ${dateTo}`,
      date_from: dateFrom,
      date_to: dateTo,
      source_filters: sourceFilters,
      status: 'pending',
      config: { fields },
      started_at: new Date().toISOString(),
    })
    .select('*')
    .single();

  if (error) {
    throw error;
  }

  return data;
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 */
export async function getArchiveBatch(supabase, batchId) {
  const { data, error } = await supabase
    .from('shape_archive_batches')
    .select('*')
    .eq('batch_id', batchId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data;
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 */
export async function runBulkExportChunk(supabase, batchId, {
  maxPages = 5,
  pageDelayMs = 400,
} = {}) {
  const batch = await getArchiveBatch(supabase, batchId);
  if (!batch) {
    const error = new Error('Archive batch not found.');
    error.statusCode = 404;
    throw error;
  }

  const fields = batch.config?.fields ?? DEFAULT_BULK_EXPORT_FIELDS;
  const sourceFilters = batch.source_filters?.length
    ? batch.source_filters
    : DEFAULT_ARCHIVE_SOURCES;

  let pageNumber = (batch.bulk_last_page ?? 0) + 1;
  let leadsSeen = batch.bulk_leads_seen ?? 0;
  let leadsMatched = batch.bulk_leads_matched ?? 0;
  let pagesProcessed = 0;
  let hasMore = true;
  const pageSummaries = [];

  await supabase
    .from('shape_archive_batches')
    .update({ status: 'bulk_running', error_summary: null })
    .eq('batch_id', batchId);

  try {
    while (pagesProcessed < maxPages && hasMore) {
      const page = await fetchShapeBulkExportPage({
        from: batch.date_from,
        to: batch.date_to,
        pageNumber,
        fields,
      });

      leadsSeen += page.leadCount;
      pagesProcessed += 1;
      hasMore = page.hasMore;

      const matched = page.leads.filter((lead) => leadMatchesSourceFilters(lead, sourceFilters));

      if (matched.length) {
        const rows = matched.map((lead) => {
          const shapeLeadId = String(lead.leadid ?? lead.lead_id ?? lead.id ?? '').trim();
          return {
            batch_id: batchId,
            shape_lead_id: shapeLeadId,
            lead_source: resolveLeadSourceLabel(lead) || null,
            mstrstatus1: lead.mstrstatus1 ?? lead.status ?? null,
            full_name: buildFullName(lead),
            phone: lead.phone ?? lead.phone_number ?? null,
            email: lead.email ?? null,
            bulk_fields: lead,
            notes_sidebar: lead.notes_sidebar ?? null,
            notes_sidebar_ai_note: lead.notes_sidebar_ai_note ?? null,
            recent_notes: lead.recent_notes ?? null,
            enrich_status: 'pending',
          };
        }).filter((row) => row.shape_lead_id);

        if (rows.length) {
          const { error: upsertError } = await supabase
            .from('shape_archive_leads')
            .upsert(rows, { onConflict: 'batch_id,shape_lead_id' });

          if (upsertError) {
            throw upsertError;
          }

          leadsMatched += rows.length;
        }
      }

      pageSummaries.push({
        pageNumber,
        leadCount: page.leadCount,
        matchedCount: matched.length,
      });

      await supabase
        .from('shape_archive_batches')
        .update({
          bulk_last_page: pageNumber,
          bulk_leads_seen: leadsSeen,
          bulk_leads_matched: leadsMatched,
        })
        .eq('batch_id', batchId);

      if (!page.leadCount) {
        hasMore = false;
        break;
      }

      pageNumber += 1;

      if (pagesProcessed < maxPages && hasMore && pageDelayMs > 0) {
        await sleep(pageDelayMs);
      }
    }

    const nextStatus = hasMore ? 'bulk_running' : 'bulk_done';

    await supabase
      .from('shape_archive_batches')
      .update({
        status: nextStatus,
        bulk_last_page: pageNumber - 1,
        bulk_leads_seen: leadsSeen,
        bulk_leads_matched: leadsMatched,
        completed_at: hasMore ? null : new Date().toISOString(),
      })
      .eq('batch_id', batchId);

    return {
      batch_id: batchId,
      phase: 'bulk',
      pages_processed: pagesProcessed,
      page_summaries: pageSummaries,
      bulk_leads_seen: leadsSeen,
      bulk_leads_matched: leadsMatched,
      has_more: hasMore,
      next_page: hasMore ? pageNumber : null,
      status: nextStatus,
    };
  } catch (error) {
    await supabase
      .from('shape_archive_batches')
      .update({
        status: 'failed',
        error_summary: error.message?.slice(0, 500) ?? 'Bulk export failed',
      })
      .eq('batch_id', batchId);
    throw error;
  }
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 */
async function linkSupabaseLeadId(supabase, shapeLeadId) {
  const { data } = await supabase
    .from('leads')
    .select('lead_id')
    .eq('shape_lead_id', String(shapeLeadId))
    .maybeSingle();

  return data?.lead_id ?? null;
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 */
async function importTranscriptNotes(supabase, batchId, archiveLead, leadId) {
  if (!leadId) {
    return 0;
  }

  const { data: transcripts, error } = await supabase
    .from('transcripts')
    .select('*')
    .eq('lead_id', leadId)
    .order('timestamp', { ascending: true });

  if (error) {
    throw error;
  }

  let inserted = 0;

  for (const transcript of transcripts ?? []) {
    const noteText =
      String(transcript.transcript_text ?? '').trim() ||
      String(transcript.fields_populated?.notes_sidebar ?? '').trim();

    if (!noteText) {
      continue;
    }

    const externalId =
      transcript.external_call_id ||
      `transcript:${transcript.transcript_id}`;

    const row = {
      batch_id: batchId,
      archive_lead_id: archiveLead.archive_lead_id,
      shape_lead_id: archiveLead.shape_lead_id,
      lead_id: leadId,
      note_source: transcript.call_source === 'LO Note' ? 'lo_note' : 'transcript',
      note_text: noteText,
      call_source: transcript.call_source ?? null,
      external_id: externalId,
      metadata: {
        ai_status_label: transcript.ai_status_label ?? null,
        fields_populated: transcript.fields_populated ?? null,
      },
      noted_at: transcript.timestamp ?? transcript.created_at ?? new Date().toISOString(),
    };

    inserted += await insertArchiveNotes(supabase, [row]);
  }

  return inserted;
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 */
export async function runEnrichChunk(supabase, batchId, {
  maxLeads = 15,
  leadDelayMs = 120,
} = {}) {
  const batch = await getArchiveBatch(supabase, batchId);
  if (!batch) {
    const error = new Error('Archive batch not found.');
    error.statusCode = 404;
    throw error;
  }

  const { data: pendingLeads, error: pendingError } = await supabase
    .from('shape_archive_leads')
    .select('*')
    .eq('batch_id', batchId)
    .eq('enrich_status', 'pending')
    .order('archived_at', { ascending: true })
    .limit(maxLeads);

  if (pendingError) {
    throw pendingError;
  }

  if (!pendingLeads?.length) {
    const { count: remaining } = await supabase
      .from('shape_archive_leads')
      .select('*', { count: 'exact', head: true })
      .eq('batch_id', batchId)
      .eq('enrich_status', 'pending');

    const done = !remaining;

    await supabase
      .from('shape_archive_batches')
      .update({
        status: done ? 'completed' : batch.status,
        completed_at: done ? new Date().toISOString() : batch.completed_at,
      })
      .eq('batch_id', batchId);

    return {
      batch_id: batchId,
      phase: 'enrich',
      enriched: 0,
      has_more: !done,
      status: done ? 'completed' : batch.status,
    };
  }

  await supabase
    .from('shape_archive_batches')
    .update({ status: 'enrich_running', error_summary: null })
    .eq('batch_id', batchId);

  let enriched = 0;
  let failed = 0;
  let notesAdded = 0;
  const summaries = [];

  for (const archiveLead of pendingLeads) {
    try {
      const detail = await fetchShapeLeadDetails(archiveLead.shape_lead_id);
      const mergedLead = {
        ...archiveLead.bulk_fields,
        ...(detail.lead ?? {}),
      };

      const leadId =
        archiveLead.lead_id ?? (await linkSupabaseLeadId(supabase, archiveLead.shape_lead_id));

      const patch = {
        lead_id: leadId,
        shape_fields: detail.lead ?? null,
        notes_sidebar: mergedLead.notes_sidebar ?? archiveLead.notes_sidebar ?? null,
        notes_sidebar_ai_note:
          mergedLead.notes_sidebar_ai_note ?? archiveLead.notes_sidebar_ai_note ?? null,
        recent_notes: mergedLead.recent_notes ?? archiveLead.recent_notes ?? null,
        mstrstatus1: mergedLead.mstrstatus1 ?? archiveLead.mstrstatus1 ?? null,
        lead_source: resolveLeadSourceLabel(mergedLead) || archiveLead.lead_source,
        full_name: buildFullName(mergedLead) || archiveLead.full_name,
        phone: mergedLead.phone ?? archiveLead.phone,
        email: mergedLead.email ?? archiveLead.email,
        enrich_status: detail.error ? 'failed' : 'done',
        enrich_error: detail.error ?? null,
        enriched_at: new Date().toISOString(),
      };

      const { data: updatedLead, error: updateError } = await supabase
        .from('shape_archive_leads')
        .update(patch)
        .eq('archive_lead_id', archiveLead.archive_lead_id)
        .select('*')
        .single();

      if (updateError) {
        throw updateError;
      }

      notesAdded += await persistLeadNotes(
        supabase,
        batchId,
        updatedLead,
        leadId,
        mergedLead,
      );

      enriched += 1;
      summaries.push({
        shape_lead_id: archiveLead.shape_lead_id,
        enrich_status: patch.enrich_status,
        notes_added: noteRows.length + transcriptNotes,
      });
    } catch (error) {
      failed += 1;
      await supabase
        .from('shape_archive_leads')
        .update({
          enrich_status: 'failed',
          enrich_error: error.message?.slice(0, 500) ?? 'Enrich failed',
          enriched_at: new Date().toISOString(),
        })
        .eq('archive_lead_id', archiveLead.archive_lead_id);

      summaries.push({
        shape_lead_id: archiveLead.shape_lead_id,
        enrich_status: 'failed',
        error: error.message,
      });
    }

    if (leadDelayMs > 0) {
      await sleep(leadDelayMs);
    }
  }

  const enrichDone = (batch.enrich_done ?? 0) + enriched;
  const enrichFailed = (batch.enrich_failed ?? 0) + failed;
  const notesCount = (batch.notes_count ?? 0) + notesAdded;

  const { count: remaining } = await supabase
    .from('shape_archive_leads')
    .select('*', { count: 'exact', head: true })
    .eq('batch_id', batchId)
    .eq('enrich_status', 'pending');

  const hasMore = (remaining ?? 0) > 0;
  const nextStatus = hasMore ? 'enrich_running' : 'completed';

  await supabase
    .from('shape_archive_batches')
    .update({
      status: nextStatus,
      enrich_done: enrichDone,
      enrich_failed: enrichFailed,
      notes_count: notesCount,
      completed_at: hasMore ? null : new Date().toISOString(),
    })
    .eq('batch_id', batchId);

  return {
    batch_id: batchId,
    phase: 'enrich',
    enriched,
    enrich_failed: failed,
    notes_added: notesAdded,
    enrich_done: enrichDone,
    enrich_failed_total: enrichFailed,
    notes_count: notesCount,
    has_more: hasMore,
    status: nextStatus,
    summaries,
  };
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 */
export async function getArchiveBatchSummary(supabase, batchId) {
  const batch = await getArchiveBatch(supabase, batchId);
  if (!batch) {
    return null;
  }

  const { count: leadCount } = await supabase
    .from('shape_archive_leads')
    .select('*', { count: 'exact', head: true })
    .eq('batch_id', batchId);

  const { count: noteCount } = await supabase
    .from('shape_archive_notes')
    .select('*', { count: 'exact', head: true })
    .eq('batch_id', batchId);

  const { count: pendingEnrich } = await supabase
    .from('shape_archive_leads')
    .select('*', { count: 'exact', head: true })
    .eq('batch_id', batchId)
    .eq('enrich_status', 'pending');

  return {
    ...batch,
    lead_count: leadCount ?? 0,
    note_count: noteCount ?? 0,
    pending_enrich: pendingEnrich ?? 0,
  };
}
