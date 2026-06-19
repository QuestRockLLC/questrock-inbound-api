import { MAILER_ROW_SELECT } from './find-lead.js';

export { MAILER_ROW_SELECT };

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 */
export async function findMailerLeadById(supabase, mailerLeadId) {
  const { data, error } = await supabase
    .from('mailer_leads')
    .select(MAILER_ROW_SELECT)
    .eq('mailer_lead_id', mailerLeadId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data;
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 */
export async function findMailerLeadByAddress(supabase, { street, city, state, zip }) {
  if (!zip && !street && !city) {
    return null;
  }

  let query = supabase.from('mailer_leads').select(MAILER_ROW_SELECT);

  if (zip) {
    query = query.eq('zip_code', String(zip).trim());
  }
  if (state) {
    query = query.ilike('state', String(state).trim());
  }
  if (city) {
    const cityClean = String(city).trim();
    query = query.ilike('city', `%${cityClean}%`);
  }

  const { data, error } = await query.order('imported_at', { ascending: false }).limit(25);
  if (error) {
    throw error;
  }

  const rows = data ?? [];
  if (!rows.length) {
    return null;
  }

  if (street) {
    const streetNorm = String(street).trim().toLowerCase().replace(/\s+/g, ' ');
    const streetNumber = street.match(/^\d+/)?.[0];
    const hit =
      rows.find((row) => {
        const addr = String(row.address_line_1 ?? '')
          .trim()
          .toLowerCase()
          .replace(/\s+/g, ' ');
        return (
          addr.includes(streetNorm) ||
          streetNorm.includes(addr) ||
          (streetNumber && addr.startsWith(`${streetNumber} `))
        );
      }) ?? rows[0];
    return hit;
  }

  return rows[0];
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 */
export async function findMailerLeadByNameAndZip(supabase, nameHint, zip) {
  if (!zip || !nameHint) {
    return null;
  }

  const { data, error } = await supabase
    .from('mailer_leads')
    .select(MAILER_ROW_SELECT)
    .eq('zip_code', String(zip).trim())
    .or(
      `full_name.ilike.%${nameHint}%,first_name.ilike.%${nameHint}%,last_name.ilike.%${nameHint}%`,
    )
    .order('imported_at', { ascending: false })
    .limit(5);

  if (error) {
    throw error;
  }

  return data?.[0] ?? null;
}
