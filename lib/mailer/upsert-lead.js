/**
 * Links a mailer row to public.leads without failing on unique phone / shape_lead_id.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 */
export async function upsertLeadForMailerRow(supabase, leadPatch, mailerStatus) {
  const patch = { ...leadPatch };
  if (patch.phone_number === '') {
    patch.phone_number = null;
  }
  if (patch.email === '') {
    patch.email = null;
  }

  if (patch.shape_lead_id) {
    const { data: byShape } = await supabase
      .from('leads')
      .select('lead_id')
      .eq('shape_lead_id', String(patch.shape_lead_id))
      .maybeSingle();

    if (byShape?.lead_id) {
      await supabase.from('leads').update(patch).eq('lead_id', byShape.lead_id);
      return byShape.lead_id;
    }
  }

  if (patch.reference_code) {
    const { data: byRef } = await supabase
      .from('leads')
      .select('lead_id')
      .eq('reference_code', patch.reference_code)
      .maybeSingle();

    if (byRef?.lead_id) {
      await supabase.from('leads').update(patch).eq('lead_id', byRef.lead_id);
      return byRef.lead_id;
    }
  }

  if (patch.phone_number) {
    const { data: byPhone } = await supabase
      .from('leads')
      .select('lead_id')
      .eq('phone_number', patch.phone_number)
      .maybeSingle();

    if (byPhone?.lead_id) {
      const { phone_number, ...rest } = patch;
      await supabase.from('leads').update(rest).eq('lead_id', byPhone.lead_id);
      return byPhone.lead_id;
    }
  }

  const { data: inserted, error } = await supabase
    .from('leads')
    .insert({
      ...patch,
      current_status_label: mailerStatus?.status_label || 'Not Contacted',
      current_status_color: mailerStatus?.color || null,
    })
    .select('lead_id')
    .single();

  if (error) {
    throw error;
  }

  return inserted.lead_id;
}
