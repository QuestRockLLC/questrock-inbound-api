import { MAILER_ROW_SELECT } from './find-lead.js';

export { MAILER_ROW_SELECT };

const STATE_ABBREV = {
  tennessee: 'TN',
  tn: 'TN',
  georgia: 'GA',
  ga: 'GA',
  florida: 'FL',
  fl: 'FL',
  'north carolina': 'NC',
  nc: 'NC',
  'south carolina': 'SC',
  sc: 'SC',
  texas: 'TX',
  tx: 'TX',
};

const STATE_FULL_NAME = {
  TN: 'Tennessee',
  GA: 'Georgia',
  FL: 'Florida',
  NC: 'North Carolina',
  SC: 'South Carolina',
  TX: 'Texas',
};

function stateOrFilter(state) {
  const key = String(state ?? '').trim().toLowerCase();
  const abbrev = STATE_ABBREV[key] ?? String(state ?? '').trim().toUpperCase();
  const full = STATE_FULL_NAME[abbrev];
  const parts = [`state.ilike.${abbrev}`];
  if (full) {
    parts.push(`state.ilike.${full}`);
  }
  return parts.join(',');
}

function pickStreetMatch(rows, street) {
  if (!street || !rows.length) {
    return null;
  }

  const streetNorm = String(street).trim().toLowerCase().replace(/\s+/g, ' ');
  const streetNumber = street.match(/^\d+/)?.[0];
  const streetCore = streetNorm.replace(/^\d+\s+/, '');

  return (
    rows.find((row) => {
      const addr = String(row.address_line_1 ?? '')
        .trim()
        .toLowerCase()
        .replace(/\s+/g, ' ');
      return (
        addr === streetNorm ||
        addr.includes(streetNorm) ||
        streetNorm.includes(addr) ||
        (streetNumber && addr.startsWith(`${streetNumber} `)) ||
        (streetCore && addr.includes(streetCore))
      );
    }) ?? null
  );
}

async function queryMailerRows(supabase, { zip, city, state, useState, useCity }) {
  let query = supabase.from('mailer_leads').select(MAILER_ROW_SELECT);

  if (zip) {
    query = query.eq('zip_code', String(zip).trim());
  }
  if (useState && state) {
    query = query.or(stateOrFilter(state));
  }
  if (useCity && city) {
    query = query.ilike('city', `%${String(city).trim()}%`);
  }

  const { data, error } = await query.order('imported_at', { ascending: false }).limit(25);
  if (error) {
    throw error;
  }

  return data ?? [];
}

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

  const attempts = [
    { useState: true, useCity: true },
    { useState: false, useCity: true },
    { useState: false, useCity: false },
  ];

  for (const attempt of attempts) {
    const rows = await queryMailerRows(supabase, { zip, city, state, ...attempt });
    if (!rows.length) {
      continue;
    }

    if (street) {
      const hit = pickStreetMatch(rows, street);
      if (hit) {
        return hit;
      }
      continue;
    }

    return rows.length === 1 ? rows[0] : null;
  }

  return null;
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 */
export async function findMailerLeadByNameAndZip(supabase, nameHint, zip) {
  if (!zip || !nameHint) {
    return null;
  }

  const tokens = [
    String(nameHint).trim(),
    ...String(nameHint)
      .trim()
      .split(/\s+/)
      .filter((part) => part.length >= 3),
  ].sort((a, b) => b.length - a.length);

  const seen = new Set();
  for (const token of tokens) {
    const key = token.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);

    const safe = token.replace(/[%_,]/g, ' ').trim();
    if (safe.length < 3) {
      continue;
    }

    const { data, error } = await supabase
      .from('mailer_leads')
      .select(MAILER_ROW_SELECT)
      .eq('zip_code', String(zip).trim())
      .or(
        `full_name.ilike.%${safe}%,first_name.ilike.%${safe}%,last_name.ilike.%${safe}%`,
      )
      .order('imported_at', { ascending: false })
      .limit(5);

    if (error) {
      throw error;
    }

    if (data?.[0]) {
      return data[0];
    }
  }

  return null;
}
