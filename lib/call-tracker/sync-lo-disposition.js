import { findTranscriptByExternalCallId } from '../transcripts.js';
import { summarizeShapeSync } from '../transcript-ai-review.js';
import { syncLoDispositionToShape } from '../disposition/shape-sync.js';
import { labelFromDispositionSlug } from '../disposition/status-slug.js';

/**
 * Push LO disposition (status + note) from Call Tracker to Shape CRM.
 */
export async function syncLoDispositionFromCallTracker(supabase, callId) {
  const rawCallId = String(callId ?? '').trim();
  if (!rawCallId) {
    const error = new Error('call_id is required');
    error.statusCode = 400;
    throw error;
  }

  const answeredKey = `${rawCallId}:answered`;
  const answered = await findTranscriptByExternalCallId(supabase, answeredKey);
  const meta = answered?.fields_populated ?? {};

  const statusSlug = meta.lo_disposition_status;
  const note = meta.lo_disposition_note ?? '';
  const loName = meta.lo_name ?? null;

  if (!statusSlug) {
    const error = new Error('No LO disposition on this call — LO must select a status first.');
    error.statusCode = 400;
    throw error;
  }

  if (!answered?.transcript_id) {
    const error = new Error('No call-answered row found for this call.');
    error.statusCode = 404;
    throw error;
  }

  const { data: lead, error: leadError } = await supabase
    .from('leads')
    .select('shape_lead_id, full_name')
    .eq('lead_id', answered.lead_id)
    .maybeSingle();

  if (leadError) {
    throw leadError;
  }

  const shapeLeadId = lead?.shape_lead_id || meta.shape_lead_id;

  if (!shapeLeadId) {
    const error = new Error('No Shape lead id linked to this call.');
    error.statusCode = 404;
    throw error;
  }

  const shapeSync = await syncLoDispositionToShape(shapeLeadId, {
    statusSlug,
    note,
    loName,
    leadName: lead?.full_name ?? null,
  });

  const loDispositionShapeSync = {
    ...summarizeShapeSync(shapeSync),
    kind: 'lo_disposition',
    status_slug: statusSlug,
    label: labelFromDispositionSlug(statusSlug),
  };

  if (answered?.transcript_id) {
    await supabase
      .from('transcripts')
      .update({
        fields_populated: {
          ...meta,
          lo_disposition_shape_sync: loDispositionShapeSync,
        },
      })
      .eq('transcript_id', answered.transcript_id);
  }

  return {
    ok: true,
    call_id: rawCallId,
    shape_lead_id: shapeLeadId,
    lo_disposition_status: statusSlug,
    lo_disposition_label: labelFromDispositionSlug(statusSlug),
    lo_disposition_note: note || null,
    lo_disposition_shape_sync: loDispositionShapeSync,
    shape_sync: shapeSync,
  };
}
