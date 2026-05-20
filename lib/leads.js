import { getDefaultStatus } from './status-definitions.js';

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 */
export async function findLeadByShapeId(supabase, shapeLeadId) {
  const { data, error } = await supabase
    .from('leads')
    .select('*')
    .eq('shape_lead_id', String(shapeLeadId))
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data;
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 */
export async function findLeadByPhone(supabase, phoneNumber) {
  const { data, error } = await supabase
    .from('leads')
    .select('*')
    .eq('phone_number', phoneNumber)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data;
}

/**
 * Shape-first upsert: link Supabase lead to Shape record after Shape search/create.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 */
export async function upsertLeadFromShapeCall(supabase, input) {
  const shapeLeadId = String(input.shapeLeadId).trim();
  const defaultStatus = await getDefaultStatus(supabase);

  const existing =
    (await findLeadByShapeId(supabase, shapeLeadId)) ??
    (input.phoneNumber ? await findLeadByPhone(supabase, input.phoneNumber) : null);

  const leadPatch = {
    shape_lead_id: shapeLeadId,
    full_name: input.fullName ?? existing?.full_name ?? null,
    phone_number: input.phoneNumber ?? existing?.phone_number ?? null,
    email: input.email ?? existing?.email ?? null,
    current_address: input.currentAddress ?? existing?.current_address ?? null,
    city: input.city ?? existing?.city ?? null,
    state: input.state ?? existing?.state ?? null,
    zip_code: input.zipCode ?? existing?.zip_code ?? null,
    company_name: input.companyName ?? existing?.company_name ?? null,
    updated_at: new Date().toISOString(),
  };

  if (!existing) {
    leadPatch.current_status_label = defaultStatus.status_label;
    leadPatch.current_status_color = defaultStatus.color;
  }

  if (existing) {
    const { data, error } = await supabase
      .from('leads')
      .update(leadPatch)
      .eq('lead_id', existing.lead_id)
      .select('*')
      .single();

    if (error) {
      throw error;
    }

    return { lead: data, created: false };
  }

  const { data, error } = await supabase.from('leads').insert(leadPatch).select('*').single();

  if (error) {
    throw error;
  }

  return { lead: data, created: true };
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 */
export async function updateLeadFromAi(supabase, leadId, { status, leadFields }) {
  const patch = {
    updated_at: new Date().toISOString(),
    current_status_label: status.status_label,
    current_status_color: status.color,
  };

  const allowedFields = [
    'full_name',
    'email',
    'current_address',
    'city',
    'state',
    'zip_code',
    'company_name',
  ];

  for (const field of allowedFields) {
    const value = leadFields?.[field];
    if (value !== undefined && value !== null && String(value).trim() !== '') {
      patch[field] = String(value).trim();
    }
  }

  const { data, error } = await supabase
    .from('leads')
    .update(patch)
    .eq('lead_id', leadId)
    .select('*')
    .single();

  if (error) {
    throw error;
  }

  return data;
}
