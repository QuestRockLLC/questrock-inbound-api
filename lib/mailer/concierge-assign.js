import { assignShapeLeadOwner } from '../shape/client.js';
import { SHAPE_CONCIERGE_USER_ID, MAILER_CONCIERGE_LO_NAME } from '../shape/concierge.js';

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * Assigns Concierge owner in Shape immediately after lead create, with retries.
 * @param {import('@supabase/supabase-js').SupabaseClient} [supabase]
 */
export async function assignConciergeAfterShapeCreate(
  supabase,
  shapeLeadId,
  mailerLeadId,
  { retries = 4, initialDelayMs = 400, retryDelayMs = 600 } = {},
) {
  if (initialDelayMs > 0) {
    await sleep(initialDelayMs);
  }

  let lastResult = null;

  for (let attempt = 1; attempt <= retries; attempt += 1) {
    lastResult = await assignShapeLeadOwner(shapeLeadId, SHAPE_CONCIERGE_USER_ID);

    if (lastResult.synced) {
      if (supabase && mailerLeadId) {
        await supabase
          .from('mailer_leads')
          .update({
            assigned_shape_user_id: SHAPE_CONCIERGE_USER_ID,
            assigned_lo_name: MAILER_CONCIERGE_LO_NAME,
            assigned_at: new Date().toISOString(),
          })
          .eq('mailer_lead_id', mailerLeadId);
      }

      return { assigned: true, attempts: attempt, result: lastResult };
    }

    if (lastResult.skipped) {
      return { assigned: false, skipped: true, attempts: attempt, result: lastResult };
    }

    if (attempt < retries) {
      await sleep(retryDelayMs * attempt);
    }
  }

  return { assigned: false, attempts: retries, result: lastResult };
}

/**
 * Assigns Concierge for batch leads that have shape_lead_id but are not marked Concierge in DB.
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 */
export async function assignConciergeOwnersForBatch(supabase, batchId, { delayMs = 100 } = {}) {
  const conciergeId = String(SHAPE_CONCIERGE_USER_ID);

  const { data: leads, error } = await supabase
    .from('mailer_leads')
    .select('mailer_lead_id, reference_code, shape_lead_id, assigned_shape_user_id')
    .eq('import_batch_id', batchId)
    .not('shape_lead_id', 'is', null)
    .or(`assigned_shape_user_id.is.null,assigned_shape_user_id.neq.${conciergeId}`);

  if (error) {
    throw error;
  }

  const summary = {
    total: leads?.length ?? 0,
    assigned: 0,
    failed: 0,
    skipped: 0,
    errors: [],
  };

  for (const lead of leads ?? []) {
    try {
      const outcome = await assignConciergeAfterShapeCreate(
        supabase,
        lead.shape_lead_id,
        lead.mailer_lead_id,
        { initialDelayMs: 0, retries: 3, retryDelayMs: 400 },
      );

      if (outcome.assigned) {
        summary.assigned += 1;
      } else if (outcome.skipped) {
        summary.skipped += 1;
        summary.errors.push({
          reference_code: lead.reference_code,
          shape_lead_id: lead.shape_lead_id,
          error: outcome.result?.reason || 'Concierge assign skipped',
        });
      } else {
        summary.failed += 1;
        summary.errors.push({
          reference_code: lead.reference_code,
          shape_lead_id: lead.shape_lead_id,
          error: outcome.result?.error || 'Concierge assign failed after retries',
        });
      }
    } catch (err) {
      summary.failed += 1;
      summary.errors.push({
        reference_code: lead.reference_code,
        error: err.message || String(err),
      });
    }

    if (delayMs > 0) {
      await sleep(delayMs);
    }
  }

  return summary;
}

/**
 * Quick pass after a sync chunk — leads still missing Concierge in DB.
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 */
export async function assignConciergeOwnersForPendingBatch(supabase, batchId, { limit = 30 } = {}) {
  const conciergeId = String(SHAPE_CONCIERGE_USER_ID);

  const { data: leads, error } = await supabase
    .from('mailer_leads')
    .select('mailer_lead_id, reference_code, shape_lead_id')
    .eq('import_batch_id', batchId)
    .not('shape_lead_id', 'is', null)
    .or(`assigned_shape_user_id.is.null,assigned_shape_user_id.neq.${conciergeId}`)
    .order('reference_code', { ascending: true })
    .limit(Math.min(limit, 50));

  if (error) {
    throw error;
  }

  const summary = { processed: leads?.length ?? 0, assigned: 0, failed: 0, errors: [] };

  for (const lead of leads ?? []) {
    const outcome = await assignConciergeAfterShapeCreate(
      supabase,
      lead.shape_lead_id,
      lead.mailer_lead_id,
      { initialDelayMs: 0, retries: 3, retryDelayMs: 400 },
    );

    if (outcome.assigned) {
      summary.assigned += 1;
    } else {
      summary.failed += 1;
      summary.errors.push({
        reference_code: lead.reference_code,
        shape_lead_id: lead.shape_lead_id,
        error: outcome.result?.error || outcome.result?.reason || 'Assign failed',
      });
    }
  }

  return summary;
}
