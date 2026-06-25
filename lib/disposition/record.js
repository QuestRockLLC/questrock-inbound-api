import { findLeadByShapeId } from '../leads.js';
import { summarizeShapeSync } from '../transcript-ai-review.js';
import { labelFromDispositionSlug, isValidDispositionSlug } from './status-slug.js';
import { syncLoDispositionToShape } from './shape-sync.js';

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 */
async function findLatestAnsweredTranscript(supabase, leadId) {
  const { data, error } = await supabase
    .from('transcripts')
    .select('transcript_id, fields_populated, external_call_id, timestamp')
    .eq('lead_id', leadId)
    .like('external_call_id', '%:answered')
    .order('timestamp', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data;
}

/**
 * Record LO disposition on the call-answered transcript row + sync Shape.
 */
export async function recordLoDisposition(supabase, input) {
  const shapeLeadId = String(input.leadId ?? input.shape_lead_id ?? '').trim();
  const statusSlug = String(input.status ?? '').trim();
  const note = String(input.note ?? '').trim();

  if (!shapeLeadId) {
    const error = new Error('leadId is required');
    error.statusCode = 400;
    throw error;
  }

  if (!isValidDispositionSlug(statusSlug)) {
    const error = new Error(`Invalid disposition status: ${statusSlug}`);
    error.statusCode = 400;
    throw error;
  }

  const lead = await findLeadByShapeId(supabase, shapeLeadId);
  if (!lead) {
    const error = new Error(`No Supabase lead for shape_lead_id ${shapeLeadId}`);
    error.statusCode = 404;
    throw error;
  }

  const answered = await findLatestAnsweredTranscript(supabase, lead.lead_id);
  const priorMeta = answered?.fields_populated ?? {};
  const recordedAt = new Date().toISOString();
  const loLabel = labelFromDispositionSlug(statusSlug);

  const loPatch = {
    lo_disposition_status: statusSlug,
    lo_disposition_label: loLabel,
    lo_disposition_note: note || null,
    lo_disposition_at: recordedAt,
    lo_name: input.loName ?? priorMeta.lo_name ?? null,
  };

  const shapeSync = await syncLoDispositionToShape(shapeLeadId, {
    statusSlug,
    note,
    loName: input.loName,
    leadName: input.leadName ?? lead.full_name,
  });

  const loDispositionShapeSync = {
    ...summarizeShapeSync(shapeSync),
    kind: 'lo_disposition',
    status_slug: statusSlug,
  };

  if (answered?.transcript_id) {
    await supabase
      .from('transcripts')
      .update({
        fields_populated: {
          ...priorMeta,
          ...loPatch,
          lo_disposition_shape_sync: loDispositionShapeSync,
        },
      })
      .eq('transcript_id', answered.transcript_id);
  }

  return {
    ok: true,
    lead_id: lead.lead_id,
    shape_lead_id: shapeLeadId,
    transcript_id: answered?.transcript_id ?? null,
    call_id: answered?.external_call_id?.replace(/:answered$/, '') ?? null,
    ...loPatch,
    shape_sync: shapeSync,
  };
}
