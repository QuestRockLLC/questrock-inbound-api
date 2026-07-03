import { summarizeShapeSync } from '../transcript-ai-review.js';
import { syncLoDispositionToShape } from '../disposition/shape-sync.js';
import {
  isValidDispositionSlug,
  labelFromDispositionSlug,
  STATUS_SLUG_META,
} from '../disposition/status-slug.js';
import { getStatusByLabel } from '../status-definitions.js';
import { updateShapeLeadFields } from '../shape/client.js';

function externalIdsForCall(callId) {
  const raw = String(callId ?? '').trim();
  if (!raw) return [];

  const ids = [`${raw}:answered`, `${raw}:transcript`];

  if (raw.startsWith('shape:')) {
    ids.push(`${raw}:created`);
  } else {
    ids.push(`shape:${raw}:created`);
  }

  return [...new Set(ids)];
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 */
export async function findCallTranscriptRows(supabase, callId) {
  const ids = externalIdsForCall(callId);
  const { data, error } = await supabase
    .from('transcripts')
    .select('transcript_id, lead_id, external_call_id, fields_populated, ai_status_label, ai_status_color')
    .in('external_call_id', ids);

  if (error) {
    throw error;
  }

  return data ?? [];
}

function answeredRow(rows) {
  return rows.find((row) => String(row.external_call_id ?? '').endsWith(':answered')) ?? null;
}

function transcriptRow(rows) {
  return rows.find((row) => String(row.external_call_id ?? '').endsWith(':transcript')) ?? null;
}

function primaryRow(rows) {
  return answeredRow(rows) ?? rows[0] ?? null;
}

export function isCallArchived(rows) {
  return rows.some((row) => Boolean(row.fields_populated?.archived_at));
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 */
export async function archiveCall(supabase, callId, { archived = true } = {}) {
  const rows = await findCallTranscriptRows(supabase, callId);
  if (!rows.length) {
    const error = new Error('Call not found.');
    error.statusCode = 404;
    throw error;
  }

  const recordedAt = new Date().toISOString();

  for (const row of rows) {
    const meta = row.fields_populated ?? {};
    const nextMeta = { ...meta };
    if (archived) {
      nextMeta.archived_at = recordedAt;
    } else {
      delete nextMeta.archived_at;
    }

    await supabase
      .from('transcripts')
      .update({ fields_populated: nextMeta })
      .eq('transcript_id', row.transcript_id);
  }

  return {
    ok: true,
    call_id: callId,
    archived,
    archived_at: archived ? recordedAt : null,
    rows_updated: rows.length,
  };
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 */
export async function deleteCall(supabase, callId) {
  const rows = await findCallTranscriptRows(supabase, callId);
  if (!rows.length) {
    const error = new Error('Call not found.');
    error.statusCode = 404;
    throw error;
  }

  const ids = rows.map((row) => row.transcript_id);
  const { error } = await supabase.from('transcripts').delete().in('transcript_id', ids);

  if (error) {
    throw error;
  }

  return {
    ok: true,
    call_id: callId,
    deleted: ids.length,
  };
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 */
export async function renameCall(supabase, callId, borrowerName) {
  const name = String(borrowerName ?? '').trim();
  if (!name) {
    const error = new Error('borrower_name is required.');
    error.statusCode = 400;
    throw error;
  }

  const rows = await findCallTranscriptRows(supabase, callId);
  const anchor = primaryRow(rows);
  if (!anchor?.lead_id) {
    const error = new Error('Call not found.');
    error.statusCode = 404;
    throw error;
  }

  const { error: leadError } = await supabase
    .from('leads')
    .update({ full_name: name, updated_at: new Date().toISOString() })
    .eq('lead_id', anchor.lead_id);

  if (leadError) {
    throw leadError;
  }

  const answered = answeredRow(rows);
  if (answered?.transcript_id) {
    const meta = answered.fields_populated ?? {};
    await supabase
      .from('transcripts')
      .update({
        fields_populated: {
          ...meta,
          display_name_override: name,
          display_name_override_at: new Date().toISOString(),
        },
      })
      .eq('transcript_id', answered.transcript_id);
  }

  const { data: lead } = await supabase
    .from('leads')
    .select('shape_lead_id')
    .eq('lead_id', anchor.lead_id)
    .maybeSingle();

  let shapeSync = { synced: false, skipped: true, reason: 'No Shape lead id' };
  if (lead?.shape_lead_id) {
    const parts = name.split(/\s+/);
    const fields = { firstname: parts[0] || name };
    if (parts.length > 1) {
      fields.lastname = parts.slice(1).join(' ');
    }
    shapeSync = await updateShapeLeadFields(lead.shape_lead_id, fields);
  }

  return {
    ok: true,
    call_id: callId,
    borrower_name: name,
    lead_id: anchor.lead_id,
    shape_sync: shapeSync,
  };
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 */
export async function updateCallStatus(
  supabase,
  callId,
  { statusType, aiStatusLabel, loDispositionStatus, syncShape = false } = {},
) {
  const type = String(statusType ?? '').trim().toLowerCase();
  const rows = await findCallTranscriptRows(supabase, callId);
  if (!rows.length) {
    const error = new Error('Call not found.');
    error.statusCode = 404;
    throw error;
  }

  const answered = answeredRow(rows);
  const transcript = transcriptRow(rows);
  const anchor = primaryRow(rows);

  if (type === 'lo') {
    const slug = String(loDispositionStatus ?? '').trim();
    if (!isValidDispositionSlug(slug)) {
      const error = new Error(`Invalid LO disposition status: ${slug}`);
      error.statusCode = 400;
      throw error;
    }

    if (!answered?.transcript_id) {
      const error = new Error('No call-answered row for LO disposition.');
      error.statusCode = 404;
      throw error;
    }

    const priorMeta = answered.fields_populated ?? {};
    const recordedAt = new Date().toISOString();
    const loLabel = labelFromDispositionSlug(slug);
    const loPatch = {
      lo_disposition_status: slug,
      lo_disposition_label: loLabel,
      lo_disposition_at: recordedAt,
    };

    let shapeSync = { synced: false, skipped: true, reason: 'sync_shape not requested' };
    if (syncShape) {
      const { data: lead } = await supabase
        .from('leads')
        .select('shape_lead_id, full_name')
        .eq('lead_id', answered.lead_id)
        .maybeSingle();

      const shapeLeadId = lead?.shape_lead_id || priorMeta.shape_lead_id;
      if (shapeLeadId) {
        shapeSync = await syncLoDispositionToShape(shapeLeadId, {
          statusSlug: slug,
          note: priorMeta.lo_disposition_note ?? '',
          loName: priorMeta.lo_name ?? null,
          leadName: lead?.full_name ?? null,
        });
        loPatch.lo_disposition_shape_sync = {
          ...summarizeShapeSync(shapeSync),
          kind: 'lo_disposition',
          status_slug: slug,
        };
      }
    }

    await supabase
      .from('transcripts')
      .update({
        fields_populated: {
          ...priorMeta,
          ...loPatch,
          status_manually_set_at: recordedAt,
          status_manually_set_by: 'call_tracker',
        },
      })
      .eq('transcript_id', answered.transcript_id);

    return {
      ok: true,
      call_id: callId,
      status_type: 'lo',
      lo_disposition_status: slug,
      lo_disposition_label: loLabel,
      shape_sync: shapeSync,
    };
  }

  if (type === 'ai') {
    const label = String(aiStatusLabel ?? '').trim();
    if (!label) {
      const error = new Error('ai_status_label is required.');
      error.statusCode = 400;
      throw error;
    }

    const statusDef = await getStatusByLabel(supabase, label);
    if (!statusDef) {
      const error = new Error(`Unknown AI status label: ${label}`);
      error.statusCode = 400;
      throw error;
    }

    const recordedAt = new Date().toISOString();
    let shapeSync = { synced: false, skipped: true, reason: 'sync_shape not requested' };

    if (transcript?.transcript_id) {
      const meta = transcript.fields_populated ?? {};
      await supabase
        .from('transcripts')
        .update({
          ai_status_label: statusDef.status_label,
          ai_status_color: statusDef.color,
          fields_populated: {
            ...meta,
            status_manually_set_at: recordedAt,
            status_manually_set_by: 'call_tracker',
          },
        })
        .eq('transcript_id', transcript.transcript_id);
    } else if (answered?.transcript_id) {
      const meta = answered.fields_populated ?? {};
      await supabase
        .from('transcripts')
        .update({
          ai_status_label: statusDef.status_label,
          ai_status_color: statusDef.color,
          fields_populated: {
            ...meta,
            status_manually_set_at: recordedAt,
            status_manually_set_by: 'call_tracker',
          },
        })
        .eq('transcript_id', answered.transcript_id);
    }

    if (anchor?.lead_id) {
      await supabase
        .from('leads')
        .update({
          current_status_label: statusDef.status_label,
          current_status_color: statusDef.color,
          updated_at: recordedAt,
        })
        .eq('lead_id', anchor.lead_id);

      if (syncShape) {
        const { data: lead } = await supabase
          .from('leads')
          .select('shape_lead_id')
          .eq('lead_id', anchor.lead_id)
          .maybeSingle();

        if (lead?.shape_lead_id) {
          shapeSync = await updateShapeLeadFields(lead.shape_lead_id, {
            mstrstatus1: statusDef.status_label,
          });
        }
      }
    }

    return {
      ok: true,
      call_id: callId,
      status_type: 'ai',
      ai_status_label: statusDef.status_label,
      ai_status_color: statusDef.color,
      shape_sync: shapeSync,
    };
  }

  const error = new Error('status_type must be "ai" or "lo".');
  error.statusCode = 400;
  throw error;
}

export function listLoDispositionOptions() {
  return Object.entries(STATUS_SLUG_META).map(([slug, meta]) => ({
    slug,
    label: meta.label,
    category: meta.category,
  }));
}
