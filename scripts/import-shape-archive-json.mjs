#!/usr/bin/env node
/**
 * Load a local shape-archive JSON export into Supabase archive tables.
 *
 * Usage:
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
 *     node scripts/import-shape-archive-json.mjs data/shape-archive-inbound-2025-12-01_2026-06-08.json
 */
import { readFileSync } from 'node:fs';
import { getSupabaseClient } from '../lib/supabase.js';
import { parseNotesSidebar } from '../lib/shape/archive.js';
import { normalizeBulkLeadRow } from '../lib/shape/bulk-export.js';

function stripHtml(value) {
  return String(value ?? '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .trim();
}

function noteRows(batchId, archiveLeadId, shapeLeadId, leadId, lead) {
  const rows = [];
  const now = new Date().toISOString();
  const sidebar = String(lead.notes_sidebar ?? lead['Notes Sidebar'] ?? '').trim();

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

  for (const [field, source] of [
    ['notes_sidebar_ai_note', 'shape_ai_note'],
    ['Notes Sidebar AI Note', 'shape_ai_note'],
    ['recent_notes', 'shape_recent'],
    ['Recent Note', 'shape_recent'],
  ]) {
    const text = String(lead[field] ?? '').trim();
    if (!text) continue;
    const plain = stripHtml(text);
    if (!plain) continue;
    rows.push({
      batch_id: batchId,
      archive_lead_id: archiveLeadId,
      shape_lead_id: shapeLeadId,
      lead_id: leadId,
      note_source: source,
      note_text: plain,
      note_html: field.includes('Note') ? text : null,
      external_id: `${source}:${shapeLeadId}`,
      metadata: {},
      noted_at: now,
    });
    break;
  }

  return rows;
}

async function main() {
  const file = process.argv[2];
  if (!file) {
    throw new Error('Usage: node scripts/import-shape-archive-json.mjs <export.json>');
  }

  const payload = JSON.parse(readFileSync(file, 'utf8'));
  const supabase = getSupabaseClient();

  const { data: batch, error: batchError } = await supabase
    .from('shape_archive_batches')
    .insert({
      batch_label: `JSON import ${payload.date_from} → ${payload.date_to}`,
      date_from: payload.date_from,
      date_to: payload.date_to,
      source_filters: payload.source_filters ?? [],
      status: 'completed',
      bulk_leads_seen: payload.lead_count,
      bulk_leads_matched: payload.lead_count,
      enrich_done: payload.lead_count,
      notes_count: 0,
      started_at: payload.exported_at,
      completed_at: new Date().toISOString(),
      config: { imported_from: file },
    })
    .select('*')
    .single();

  if (batchError) {
    throw batchError;
  }

  let notesCount = 0;

  for (const raw of payload.leads ?? []) {
    const lead = normalizeBulkLeadRow(raw);
    const shapeLeadId = String(lead.leadid ?? raw['Lead ID'] ?? '').trim();
    if (!shapeLeadId) continue;

    const { data: existingLead } = await supabase
      .from('leads')
      .select('lead_id')
      .eq('shape_lead_id', shapeLeadId)
      .maybeSingle();

    const { data: archiveLead, error: leadError } = await supabase
      .from('shape_archive_leads')
      .insert({
        batch_id: batch.batch_id,
        shape_lead_id: shapeLeadId,
        lead_id: existingLead?.lead_id ?? null,
        lead_source: lead.leadsource ?? raw.Source ?? null,
        mstrstatus1: lead.mstrstatus1 ?? raw['Lead Status'] ?? null,
        full_name: `${lead.firstname ?? ''} ${lead.lastname ?? ''}`.trim() || null,
        phone: lead.phone ?? null,
        email: lead.email ?? null,
        bulk_fields: raw,
        shape_fields: raw._search_detail ?? null,
        notes_sidebar: lead.notes_sidebar ?? null,
        notes_sidebar_ai_note: lead.notes_sidebar_ai_note ?? null,
        recent_notes: lead.recent_notes ?? null,
        enrich_status: 'done',
        enriched_at: new Date().toISOString(),
      })
      .select('*')
      .single();

    if (leadError) {
      throw leadError;
    }

    const rows = noteRows(
      batch.batch_id,
      archiveLead.archive_lead_id,
      shapeLeadId,
      existingLead?.lead_id ?? null,
      lead,
    );

    if (rows.length) {
      const { error: notesError } = await supabase
        .from('shape_archive_notes')
        .upsert(rows, { onConflict: 'external_id' });

      if (notesError) {
        throw notesError;
      }

      notesCount += rows.length;
    }

    if (existingLead?.lead_id) {
      const { data: transcripts } = await supabase
        .from('transcripts')
        .select('*')
        .eq('lead_id', existingLead.lead_id);

      for (const transcript of transcripts ?? []) {
        const noteText =
          String(transcript.transcript_text ?? '').trim() ||
          String(transcript.fields_populated?.notes_sidebar ?? '').trim();

        if (!noteText) continue;

        const externalId =
          transcript.external_call_id || `transcript:${transcript.transcript_id}`;

        const { error: tError } = await supabase.from('shape_archive_notes').upsert(
          {
            batch_id: batch.batch_id,
            archive_lead_id: archiveLead.archive_lead_id,
            shape_lead_id: shapeLeadId,
            lead_id: existingLead.lead_id,
            note_source: transcript.call_source === 'LO Note' ? 'lo_note' : 'transcript',
            note_text: noteText,
            call_source: transcript.call_source ?? null,
            external_id: externalId,
            metadata: {
              ai_status_label: transcript.ai_status_label ?? null,
            },
            noted_at: transcript.timestamp ?? new Date().toISOString(),
          },
          { onConflict: 'external_id' },
        );

        if (!tError) {
          notesCount += 1;
        }
      }
    }
  }

  await supabase
    .from('shape_archive_batches')
    .update({ notes_count: notesCount })
    .eq('batch_id', batch.batch_id);

  console.info('[import-json] done', {
    batch_id: batch.batch_id,
    leads: payload.lead_count,
    notes: notesCount,
  });
}

main().catch((error) => {
  console.error('[import-json] failed', error.message);
  process.exit(1);
});
