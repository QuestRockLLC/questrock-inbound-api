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

function normalizeName(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

/**
 * Last-resort lookup: find an existing mailer_leads row by full name when the
 * mailer lead had no phone (so Zapier couldn't match it in Shape and created a
 * new Shape lead). Only matches rows with no phone on file to avoid collisions.
 *
 * Returns { lead, mailerLeadId, oldShapeLeadId } or null.
 */
async function findLeadViaMailerName(supabase, fullName) {
  if (!fullName || normalizeName(fullName) === 'unknown caller') {
    return null;
  }

  const { data: mailerRow, error } = await supabase
    .from('mailer_leads')
    .select('mailer_lead_id, lead_id, full_name, phone, shape_lead_id')
    .ilike('full_name', normalizeName(fullName))
    .is('phone', null)
    .limit(1)
    .maybeSingle();

  if (error || !mailerRow?.lead_id) {
    return null;
  }

  const { data: lead } = await supabase
    .from('leads')
    .select('*')
    .eq('lead_id', mailerRow.lead_id)
    .maybeSingle();

  if (!lead) {
    return null;
  }

  return {
    lead,
    mailerLeadId: mailerRow.mailer_lead_id,
    oldShapeLeadId: mailerRow.shape_lead_id ?? null,
  };
}

/**
 * Back-fills a mailer_leads row with the caller's phone and the new Shape ID
 * after a name-based match so future calls resolve correctly.
 */
async function backfillMailerLeadFromCall(supabase, mailerLeadId, { shapeLeadId, phone }) {
  const patch = {
    shape_synced_at: new Date().toISOString(),
  };
  if (shapeLeadId) {
    patch.shape_lead_id = shapeLeadId;
  }
  if (phone) {
    patch.phone = phone;
  }

  await supabase
    .from('mailer_leads')
    .update(patch)
    .eq('mailer_lead_id', mailerLeadId);
}

/**
 * QuestMail hold-at-answer: Supabase row only until transcript identifies mailer lead.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 */
export async function createPendingCallLead(supabase, input) {
  const defaultStatus = await getDefaultStatus(supabase);

  const { data, error } = await supabase
    .from('leads')
    .insert({
      shape_lead_id: null,
      full_name: input.fullName ?? 'QuestMail Caller',
      phone_number: input.phoneNumber ?? null,
      email: input.email ?? null,
      lead_source: input.leadSource ?? 'questmail',
      reference_code: input.referenceCode ?? null,
      current_status_label: defaultStatus.status_label,
      current_status_color: defaultStatus.color,
      updated_at: new Date().toISOString(),
    })
    .select('*')
    .single();

  if (error) {
    throw error;
  }

  return { lead: data, created: true };
}

/**
 * Shape-first upsert: link Supabase lead to Shape record after Shape search/create.
 * Lookup order:
 *   1. leads.shape_lead_id — exact Shape ID match (normal path)
 *   2. leads.phone_number — caller phone match (repeat caller)
 *   3. mailer_leads.full_name — name match where mailer had no phone
 *      (handles Zapier creating a new Shape lead because mailer CSV had no phone)
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 */
export async function upsertLeadFromShapeCall(supabase, input) {
  const shapeLeadId = String(input.shapeLeadId).trim();
  const defaultStatus = await getDefaultStatus(supabase);

  let mailerMatch = null;

  let existing = await findLeadByShapeId(supabase, shapeLeadId);

  if (!existing && input.phoneNumber) {
    existing = await findLeadByPhone(supabase, input.phoneNumber);
  }

  if (!existing && input.fullName) {
    mailerMatch = await findLeadViaMailerName(supabase, input.fullName);
    if (mailerMatch) {
      existing = mailerMatch.lead;
    }
  }

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
    lead_source: input.leadSource ?? existing?.lead_source ?? null,
    reference_code: input.referenceCode ?? existing?.reference_code ?? null,
    updated_at: new Date().toISOString(),
  };

  if (!existing) {
    leadPatch.current_status_label = defaultStatus.status_label;
    leadPatch.current_status_color = defaultStatus.color;
  }

  let lead;
  let created;

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

    lead = data;
    created = false;
  } else {
    const { data, error } = await supabase
      .from('leads')
      .insert(leadPatch)
      .select('*')
      .single();

    if (error) {
      throw error;
    }

    lead = data;
    created = true;
  }

  // Back-fill mailer_leads with the caller's phone + new Shape ID so next
  // call resolves via shape_lead_id (tier 1) instead of name fallback.
  if (mailerMatch) {
    await backfillMailerLeadFromCall(supabase, mailerMatch.mailerLeadId, {
      shapeLeadId,
      phone: input.phoneNumber ?? null,
    });
  }

  return {
    lead,
    created,
    mailerMatched: mailerMatch
      ? {
          mailer_lead_id: mailerMatch.mailerLeadId,
          old_shape_lead_id: mailerMatch.oldShapeLeadId,
          merged_into_new_shape_lead_id: shapeLeadId,
        }
      : null,
  };
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
