import { createShapeLeadViaPost } from '../shape/client.js';
import { getStatusByLabel } from '../status-definitions.js';
import { buildShapeLeadPayload } from './normalize.js';

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
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
    shapeDelayMs = 120,
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

  const { data: batch, error: batchError } = await supabase
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

  const mailerStatus =
    (await getStatusByLabel(supabase, 'Not Contacted')) ??
    (await getStatusByLabel(supabase, 'First Call Appointment Scheduled'));

  for (const entry of rows) {
    const { row, raw, index } = entry;

    try {
      const { data: existingMailer } = await supabase
        .from('mailer_leads')
        .select('*')
        .eq('reference_code', row.reference_code)
        .maybeSingle();

      let shapeLeadId = existingMailer?.shape_lead_id ?? null;

      if (syncShape && !shapeLeadId) {
        const shapePayload = buildShapeLeadPayload(row);
        const shapeResult = await createShapeLeadViaPost(shapePayload);

        if (shapeResult.created && shapeResult.shape_lead_id) {
          shapeLeadId = shapeResult.shape_lead_id;
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
      } else if (syncShape) {
        summary.shape_skipped += 1;
      }

      const mailerPatch = {
        reference_code: row.reference_code,
        import_batch_id: batch.batch_id,
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
        shape_lead_id: shapeLeadId,
        raw_row: raw,
        imported_at: new Date().toISOString(),
        shape_synced_at: shapeLeadId ? new Date().toISOString() : null,
      };

      const { data: mailerLead, error: mailerError } = await supabase
        .from('mailer_leads')
        .upsert(mailerPatch, { onConflict: 'reference_code' })
        .select('*')
        .single();

      if (mailerError) {
        throw mailerError;
      }

      summary.db_upserted += 1;

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
        shape_lead_id: shapeLeadId,
        updated_at: new Date().toISOString(),
      };

      let leadId = mailerLead.lead_id ?? null;

      if (leadId) {
        await supabase.from('leads').update(leadPatch).eq('lead_id', leadId);
      } else if (shapeLeadId) {
        const { data: existingLead } = await supabase
          .from('leads')
          .select('lead_id')
          .eq('shape_lead_id', String(shapeLeadId))
          .maybeSingle();

        if (existingLead) {
          leadId = existingLead.lead_id;
          await supabase.from('leads').update(leadPatch).eq('lead_id', leadId);
        } else {
          const { data: newLead, error: leadError } = await supabase
            .from('leads')
            .insert({
              ...leadPatch,
              current_status_label: mailerStatus?.status_label || 'Not Contacted',
              current_status_color: mailerStatus?.color || null,
            })
            .select('lead_id')
            .single();

          if (leadError) {
            throw leadError;
          }

          leadId = newLead.lead_id;
        }
      } else {
        const { data: existingByRef } = await supabase
          .from('leads')
          .select('lead_id')
          .eq('reference_code', row.reference_code)
          .maybeSingle();

        if (existingByRef) {
          leadId = existingByRef.lead_id;
          await supabase.from('leads').update(leadPatch).eq('lead_id', leadId);
        } else {
          const { data: newLead, error: leadError } = await supabase
            .from('leads')
            .insert({
              ...leadPatch,
              current_status_label: mailerStatus?.status_label || 'Not Contacted',
              current_status_color: mailerStatus?.color || null,
            })
            .select('lead_id')
            .single();

          if (leadError) {
            throw leadError;
          }

          leadId = newLead.lead_id;
        }
      }

      if (leadId && mailerLead.lead_id !== leadId) {
        await supabase
          .from('mailer_leads')
          .update({ lead_id: leadId })
          .eq('mailer_lead_id', mailerLead.mailer_lead_id);
      }
    } catch (error) {
      summary.errors.push({
        row: index,
        reference_code: row.reference_code,
        stage: 'import',
        error: error.message || String(error),
      });
    }
  }

  summary.skipped = summary.errors.length;

  await supabase
    .from('mailer_import_batches')
    .update({
      shape_synced_count: summary.shape_created,
      db_upserted_count: summary.db_upserted,
      skipped_count: summary.skipped,
      error_count: summary.errors.length,
    })
    .eq('batch_id', batch.batch_id);

  return {
    batch_id: batch.batch_id,
    batch_label: batchLabel,
    dry_run: false,
    summary,
  };
}
