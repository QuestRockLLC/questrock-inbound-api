const LEAD_SELECT =
  'mailer_lead_id, reference_code, full_name, first_name, last_name, address_line_1, city, state, zip_code, phone, email, assigned_lo_name, assigned_at, shape_lead_id, mail_date, imported_at';

function normalizeLoName(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function quotedLoFilter(loName) {
  const lo = String(loName ?? '').trim().replace(/"/g, '""');
  return `assigned_lo_name.eq."${lo}",assigned_lo_name.is.null`;
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 */
export async function listRecentMailerLeads(supabase, { limit = 50 } = {}) {
  const { data, error } = await supabase
    .from('mailer_leads')
    .select(LEAD_SELECT)
    .order('imported_at', { ascending: false })
    .limit(Math.min(limit, 100));

  if (error) {
    throw error;
  }

  return data ?? [];
}

export async function listMailerLeadsForLo(supabase, loName, { limit = 50 } = {}) {
  const lo = String(loName ?? '').trim();
  if (!lo) return [];

  const { data, error } = await supabase
    .from('mailer_leads')
    .select(LEAD_SELECT)
    .or(quotedLoFilter(lo))
    .order('imported_at', { ascending: false })
    .limit(Math.min(limit, 100));

  if (error) {
    throw error;
  }

  return data ?? [];
}

/**
 * Search all mailer leads by name, code, address, phone, etc.
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 */
export async function searchMailerLeads(supabase, query, { limit = 25 } = {}) {
  const q = String(query ?? '').trim();
  if (!q || q.length < 2) {
    return [];
  }

  const safe = q.replace(/[%_,]/g, ' ').trim();
  const pattern = `%${safe}%`;
  const exactCode = /^[A-Z0-9]+$/i.test(safe) ? safe.toUpperCase() : null;

  if (exactCode) {
    const { data: exactRows, error: exactError } = await supabase
      .from('mailer_leads')
      .select(LEAD_SELECT)
      .eq('reference_code', exactCode)
      .limit(5);

    if (exactError) {
      throw exactError;
    }

    if (exactRows?.length) {
      return exactRows;
    }
  }

  const { data, error } = await supabase
    .from('mailer_leads')
    .select(LEAD_SELECT)
    .or(
      `reference_code.ilike.${pattern},full_name.ilike.${pattern},first_name.ilike.${pattern},last_name.ilike.${pattern},address_line_1.ilike.${pattern},city.ilike.${pattern},zip_code.ilike.${pattern},phone.ilike.${pattern},email.ilike.${pattern}`,
    )
    .order('imported_at', { ascending: false })
    .limit(Math.min(limit, 50));

  if (error) {
    throw error;
  }

  return data ?? [];
}
