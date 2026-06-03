import { createShapeLeadViaPost } from '../shape/client.js';
import { getStatusByLabel } from '../status-definitions.js';
import { buildShapeLeadPayload } from './normalize.js';
import { upsertLeadForMailerRow } from './upsert-lead.js';

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 */
export async function importMailerRowToDatabase(supabase, entry, { batchId, mailerStatus, existingMailer }) {
  const { row, raw, index } = entry;

  const mailerPatch = {
    reference_code: row.reference_code,
    import_batch_id: batchId,
    full_name: row.full_name,
    first_name: row.first_name,
    last_name: row.last_name,
    address_line_1: row.address_line_1,
    address_line_2: row.address_line_2,
    city: row.city,
    state: row.state,
    zip_code: row.zip_code,
    county: row.county,
    mtg_amount: row.mtg_amount,
    property_date: row.property_date,
    lender: row.lender,
    loan_type: row.loan_type,
    rate_type: row.rate_type,
    new_rate: row.new_rate,
    new_apr: row.new_apr,
    debt_amount: row.debt_amount,
    new_total_payment: row.new_total_payment,
    mail_date: row.mail_date,
    offer_expires: row.offer_expires,
    phone: row.phone || null,
    email: row.email || null,
    shape_lead_id: existingMailer?.shape_lead_id ?? null,
    raw_row: raw,
    imported_at: new Date().toISOString(),
    shape_synced_at: existingMailer?.shape_synced_at ?? null,
  };

  const { data: mailerLead, error: mailerError } = await supabase
    .from('mailer_leads')
    .upsert(mailerPatch, { onConflict: 'reference_code' })
    .select('*')
    .single();

  if (mailerError) {
    throw mailerError;
  }

  const leadPatch = {
    reference_code: row.reference_code,
    lead_source: 'mail',
    full_name: row.full_name,
    phone_number: row.phone || null,
    email: row.email || null,
    current_address: row.address_line_1 || null,
    city: row.city || null,
    state: row.state || null,
    zip_code: row.zip_code || null,
    shape_lead_id: mailerLead.shape_lead_id,
    updated_at: new Date().toISOString(),
  };

  const leadId = await upsertLeadForMailerRow(supabase, leadPatch, mailerStatus);

  if (leadId && mailerLead.lead_id !== leadId) {
    await supabase.from('mailer_leads').update({ lead_id: leadId }).eq('mailer_lead_id', mailerLead.mailer_lead_id);
  }

  return { mailerLead, leadId, index };
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 */
export async function syncMailerRowsToShape(supabase, rows, { shapeDelayMs = 80 } = {}) {
  const summary = {
    shape_created: 0,
    shape_skipped: 0,
    shape_failed: 0,
    errors: [],
  };

  for (const entry of rows) {
    const { row, index } = entry;

    try {
      const { data: mailerLead } = await supabase
        .from('mailer_leads')
        .select('mailer_lead_id, shape_lead_id')
        .eq('reference_code', row.reference_code)
        .maybeSingle();

      if (!mailerLead) {
        summary.errors.push({
          row: index,
          reference_code: row.reference_code,
          stage: 'shape',
          error: 'Row not found in mailer_leads — import to Supabase first.',
        });
        continue;
      }

      if (mailerLead.shape_lead_id) {
        summary.shape_skipped += 1;
        continue;
      }

      const shapeResult = await createShapeLeadViaPost(buildShapeLeadPayload(row));

      if (shapeResult.created && shapeResult.shape_lead_id) {
        const now = new Date().toISOString();
        await supabase
          .from('mailer_leads')
          .update({
            shape_lead_id: shapeResult.shape_lead_id,
            shape_synced_at: now,
          })
          .eq('mailer_lead_id', mailerLead.mailer_lead_id);

        await supabase
          .from('leads')
          .update({
            shape_lead_id: shapeResult.shape_lead_id,
            updated_at: now,
          })
          .eq('reference_code', row.reference_code);

        summary.shape_created += 1;
      } else if (shapeResult.skipped) {
        summary.shape_skipped += 1;
        summary.errors.push({
          row: index,
          reference_code: row.reference_code,
          stage: 'shape',
          error: shapeResult.reason || 'Shape sync skipped',
        });
      } else {
        summary.shape_failed += 1;
        summary.errors.push({
          row: index,
          reference_code: row.reference_code,
          stage: 'shape',
          error: shapeResult.error || 'Shape create failed',
          shape_response: shapeResult.shape_response,
        });
      }

      if (shapeDelayMs > 0) {
        await sleep(shapeDelayMs);
      }
    } catch (error) {
      summary.errors.push({
        row: index,
        reference_code: row.reference_code,
        stage: 'shape',
        error: error.message || String(error),
      });
    }
  }

  return summary;
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 */
export async function importMailerRows(supabase, options) {
  const {
    rows,
    batchLabel = new Date().toISOString().slice(0, 10),
    syncShape = true,
    dryRun = false,
    shapeDelayMs = 80,
    existingBatchId = null,
  } = options;

  const summary = {
    total: rows.length,
    db_upserted: 0,
    shape_created: 0,
    shape_skipped: 0,
    shape_failed: 0,
    skipped: 0,
    errors: [],
  };

  if (dryRun) {
    return {
      batch_id: null,
      dry_run: true,
      summary: {
        ...summary,
        preview: rows.slice(0, 5).map(({ row }) => ({
          reference_code: row.reference_code,
          full_name: row.full_name,
          city: row.city,
          state: row.state,
        })),
      },
    };
  }

  let batch;

  if (existingBatchId) {
    const { data, error } = await supabase
      .from('mailer_import_batches')
      .select('*')
      .eq('batch_id', existingBatchId)
      .single();

    if (error) {
      throw error;
    }

    batch = data;
  } else {
    const { data, error: batchError } = await supabase
      .from('mailer_import_batches')
      .insert({
        batch_label: batchLabel,
        row_count: rows.length,
        dry_run: false,
      })
      .select('*')
      .single();

    if (batchError) {
      throw batchError;
    }

    batch = data;
  }

  const mailerStatus =
    (await getStatusByLabel(supabase, 'Not Contacted')) ??
    (await getStatusByLabel(supabase, 'First Call Appointment Scheduled'));

  for (const entry of rows) {
    const { row, index } = entry;

    try {
      const { data: existingMailer } = await supabase
        .from('mailer_leads')
        .select('mailer_lead_id, shape_lead_id, shape_synced_at')
        .eq('reference_code', row.reference_code)
        .maybeSingle();

      await importMailerRowToDatabase(supabase, entry, {
        batchId: batch.batch_id,
        mailerStatus,
        existingMailer,
      });

      summary.db_upserted += 1;
    } catch (error) {
      summary.errors.push({
        row: index,
        reference_code: row.reference_code,
        stage: 'import',
        error: error.message || String(error),
        code: error.code,
      });
    }
  }

  if (syncShape) {
    const shapeSummary = await syncMailerRowsToShape(supabase, rows, { shapeDelayMs });
    summary.shape_created = shapeSummary.shape_created;
    summary.shape_skipped = shapeSummary.shape_skipped;
    summary.shape_failed = shapeSummary.shape_failed;
    summary.errors.push(...shapeSummary.errors);
  }

  summary.skipped = summary.errors.length;

  const { data: priorBatch } = await supabase
    .from('mailer_import_batches')
    .select('db_upserted_count, shape_synced_count, error_count')
    .eq('batch_id', batch.batch_id)
    .single();

  await supabase
    .from('mailer_import_batches')
    .update({
      row_count: (priorBatch?.db_upserted_count ?? 0) + summary.db_upserted,
      shape_synced_count: (priorBatch?.shape_synced_count ?? 0) + summary.shape_created,
      db_upserted_count: (priorBatch?.db_upserted_count ?? 0) + summary.db_upserted,
      skipped_count: summary.skipped,
      error_count: (priorBatch?.error_count ?? 0) + summary.errors.length,
    })
    .eq('batch_id', batch.batch_id);

  return {
    batch_id: batch.batch_id,
    batch_label: batchLabel,
    dry_run: false,
    summary,
  };
}
