import { normalizeMailerRow } from './normalize.js';
import { syncMailerRowsToShape } from './import.js';

/**
 * Build a normalized row for Shape from a mailer_leads DB record.
 */
export function mailerLeadRecordToRow(mailerLead) {
  if (mailerLead?.raw_row && typeof mailerLead.raw_row === 'object') {
    const fromRaw = normalizeMailerRow(mailerLead.raw_row);
    if (fromRaw) {
      return fromRaw;
    }
  }

  return normalizeMailerRow({
    'Offer Code': mailerLead.reference_code,
    'Full Name': mailerLead.full_name,
    'First Name': mailerLead.first_name,
    'Last Name': mailerLead.last_name,
    'Address Line 1': mailerLead.address_line_1,
    'Address Line 2': mailerLead.address_line_2,
    City: mailerLead.city,
    State: mailerLead.state,
    'ZIP Code': mailerLead.zip_code,
    COUNTY: mailerLead.county,
    MTGAMT: mailerLead.mtg_amount,
    PROPERDATE: mailerLead.property_date,
    LENDER: mailerLead.lender,
    TYPE: mailerLead.loan_type,
    'NEW RATE': mailerLead.new_rate,
    'NEW APR': mailerLead.new_apr,
    'NEW_PI_PAY': mailerLead.new_total_payment,
    'Mail Date': mailerLead.mail_date,
    Expir: mailerLead.offer_expires,
    'CURR PAY': mailerLead.curr_pay_date,
    'NEW PAY': mailerLead.new_pay_date,
    Phone: mailerLead.phone,
    Email: mailerLead.email,
  });
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 */
export async function countMailerLeadsWithoutShape(supabase, batchId) {
  const { count, error } = await supabase
    .from('mailer_leads')
    .select('mailer_lead_id', { count: 'exact', head: true })
    .eq('import_batch_id', batchId)
    .is('shape_lead_id', null);

  if (error) {
    throw error;
  }

  return count ?? 0;
}

/**
 * Syncs the next chunk of batch leads that lack shape_lead_id (no CSV re-upload).
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 */
export async function syncMailerBatchToShape(supabase, batchId, { limit = 20, shapeDelayMs = 60 } = {}) {
  const safeLimit = Math.min(Math.max(Number(limit) || 20, 1), 30);

  const { data: leads, error } = await supabase
    .from('mailer_leads')
    .select('*')
    .eq('import_batch_id', batchId)
    .is('shape_lead_id', null)
    .order('reference_code', { ascending: true })
    .limit(safeLimit);

  if (error) {
    throw error;
  }

  if (!leads?.length) {
    return {
      processed: 0,
      shape_created: 0,
      shape_skipped: 0,
      shape_failed: 0,
      errors: [],
      remaining_without_shape: 0,
      done: true,
    };
  }

  const entries = [];
  for (let i = 0; i < leads.length; i += 1) {
    const row = mailerLeadRecordToRow(leads[i]);
    if (!row) {
      entries.push({
        index: i + 1,
        row: { reference_code: leads[i].reference_code || 'UNKNOWN' },
        raw: leads[i].raw_row,
      });
    } else {
      entries.push({ index: i + 1, row, raw: leads[i].raw_row });
    }
  }

  const summary = await syncMailerRowsToShape(supabase, entries, { shapeDelayMs });
  const remaining = await countMailerLeadsWithoutShape(supabase, batchId);

  if (summary.shape_created > 0 || summary.errors.length > 0) {
    const { data: priorBatch } = await supabase
      .from('mailer_import_batches')
      .select('shape_synced_count, error_count')
      .eq('batch_id', batchId)
      .single();

    await supabase
      .from('mailer_import_batches')
      .update({
        shape_synced_count: (priorBatch?.shape_synced_count ?? 0) + summary.shape_created,
        error_count: (priorBatch?.error_count ?? 0) + summary.errors.length,
      })
      .eq('batch_id', batchId);
  }

  return {
    processed: leads.length,
    ...summary,
    remaining_without_shape: remaining,
    done: remaining === 0,
  };
}
