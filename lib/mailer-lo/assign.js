import { assignShapeLeadOwner } from '../shape/client.js';
import { resolveShapeLoUserId, getShapeLoRoster } from '../shape/lo-roster.js';

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 */
export async function assignMailerLeadToLo(supabase, { referenceCode, mailerLeadId, loName, note }) {
  const lo = String(loName ?? '').trim();
  if (!lo) {
    const error = new Error('lo_name is required.');
    error.statusCode = 400;
    throw error;
  }

  const depursLo = resolveShapeLoUserId(lo);

  let query = supabase.from('mailer_leads').select('*');

  if (mailerLeadId) {
    query = query.eq('mailer_lead_id', mailerLeadId);
  } else {
    query = query.eq('reference_code', String(referenceCode).trim().toUpperCase());
  }

  const { data: existing, error: fetchError } = await query.maybeSingle();

  if (fetchError) {
    throw fetchError;
  }

  if (!existing) {
    const error = new Error('Mailer lead not found.');
    error.statusCode = 404;
    throw error;
  }

  const previousLo = existing.assigned_lo_name;
  const now = new Date().toISOString();

  let shapeAssignment = {
    synced: false,
    skipped: true,
    reason: 'No matching LO in Shape roster',
  };

  if (!depursLo) {
    shapeAssignment = {
      synced: false,
      skipped: true,
      reason: `Unknown LO "${lo}". Use an exact name from the roster.`,
      roster: getShapeLoRoster().map((entry) => entry.name),
    };
  } else if (!existing.shape_lead_id) {
    shapeAssignment = {
      synced: false,
      skipped: true,
      reason: 'Lead has no shape_lead_id yet — import to Shape first.',
    };
  } else {
    shapeAssignment = await assignShapeLeadOwner(existing.shape_lead_id, depursLo);
  }

  const { data: updated, error: updateError } = await supabase
    .from('mailer_leads')
    .update({
      assigned_lo_name: lo,
      assigned_at: now,
      assigned_shape_user_id: depursLo ?? existing.assigned_shape_user_id ?? null,
    })
    .eq('mailer_lead_id', existing.mailer_lead_id)
    .select('*')
    .single();

  if (updateError) {
    throw updateError;
  }

  const { error: eventError } = await supabase.from('mailer_lo_events').insert({
    mailer_lead_id: existing.mailer_lead_id,
    reference_code: existing.reference_code,
    event_type: 'assigned',
    lo_name: lo,
    details: {
      previous_lo: previousLo,
      note: note || null,
      depursLo: depursLo ?? null,
      shape_assignment: shapeAssignment,
    },
  });

  if (eventError) {
    throw eventError;
  }

  if (note?.trim()) {
    await supabase.from('mailer_lo_events').insert({
      mailer_lead_id: existing.mailer_lead_id,
      reference_code: existing.reference_code,
      event_type: 'note',
      lo_name: lo,
      details: { note: note.trim() },
    });
  }

  return {
    mailer_lead: updated,
    previous_lo: previousLo,
    assigned_at: now,
    depursLo: depursLo ?? null,
    shape_assignment: shapeAssignment,
  };
}
