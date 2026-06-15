import { assignShapeLeadOwner } from '../shape/client.js';
import { SHAPE_CONCIERGE_USER_ID } from '../shape/concierge.js';

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * Assigns Shape owner to Concierge for all leads in an import batch that have shape_lead_id.
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 */
export async function assignConciergeOwnersForBatch(supabase, batchId, { delayMs = 100 } = {}) {
  const { data: leads, error } = await supabase
    .from('mailer_leads')
    .select('mailer_lead_id, reference_code, shape_lead_id')
    .eq('import_batch_id', batchId)
    .not('shape_lead_id', 'is', null);

  if (error) {
    throw error;
  }

  const summary = {
    total: leads?.length ?? 0,
    assigned: 0,
    failed: 0,
    errors: [],
  };

  for (const lead of leads ?? []) {
    try {
      const result = await assignShapeLeadOwner(lead.shape_lead_id, SHAPE_CONCIERGE_USER_ID);
      if (result.synced) {
        summary.assigned += 1;
        await supabase
          .from('mailer_leads')
          .update({ assigned_shape_user_id: SHAPE_CONCIERGE_USER_ID })
          .eq('mailer_lead_id', lead.mailer_lead_id);
      } else {
        summary.failed += 1;
        summary.errors.push({
          reference_code: lead.reference_code,
          shape_lead_id: lead.shape_lead_id,
          error: result.error || result.reason || 'Assign failed',
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
