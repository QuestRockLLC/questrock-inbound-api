import { normalizePhoneDigits } from '../phone.js';

export const MAILER_ROW_SELECT =
  'mailer_lead_id, reference_code, full_name, first_name, last_name, address_line_1, address_line_2, city, state, zip_code, county, phone, email, assigned_lo_name, shape_lead_id, mail_date, imported_at, mtg_amount, new_rate, new_total_payment, loan_type, rate_type, debt_amount, property_date, lender';

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 */
export async function findMailerLeadByPhone(supabase, phone) {
  const phone10 = normalizePhoneDigits(phone);
  if (phone10.length !== 10) {
    return null;
  }

  const formatted = `(${phone10.slice(0, 3)}) ${phone10.slice(3, 6)}-${phone10.slice(6)}`;

  const { data, error } = await supabase
    .from('mailer_leads')
    .select(MAILER_ROW_SELECT)
    .or(`phone.eq.${phone10},phone.eq.${formatted},phone.ilike.%${phone10}%`)
    .order('imported_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data ?? null;
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 */
export async function findMailerLeadByReferenceCode(supabase, code) {
  const normalized = String(code ?? '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
  if (!normalized || normalized.length < 4) {
    return null;
  }

  const { data, error } = await supabase
    .from('mailer_leads')
    .select(MAILER_ROW_SELECT)
    .eq('reference_code', normalized)
    .maybeSingle();

  if (error) {
    throw error;
  }

  if (data) {
    return data;
  }

  if (normalized.startsWith('624') && normalized.length >= 7) {
    const { data: prefixMatch, error: prefixError } = await supabase
      .from('mailer_leads')
      .select(MAILER_ROW_SELECT)
      .ilike('reference_code', `${normalized}%`)
      .order('imported_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (prefixError) {
      throw prefixError;
    }
    if (prefixMatch) {
      return prefixMatch;
    }

    const { data: containsMatch, error: containsError } = await supabase
      .from('mailer_leads')
      .select(MAILER_ROW_SELECT)
      .ilike('reference_code', `%${normalized}%`)
      .order('imported_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (containsError) {
      throw containsError;
    }
    if (containsMatch) {
      return containsMatch;
    }
  }

  return null;
}
