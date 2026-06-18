import { createShapeLeadViaPost } from '../shape/client.js';
import { buildShapeLeadPayload } from './normalize.js';

/**
 * Use existing mailer Shape lead or create from imported mailer row (Mail source).
 */
export async function ensureMailerShapeLeadForRow(supabase, mailerRow, { phoneDigits, formattedPhone }) {
  if (mailerRow.shape_lead_id) {
    return { shapeLeadId: String(mailerRow.shape_lead_id), created: false };
  }

  const payload = buildShapeLeadPayload({
    ...mailerRow,
    phone: phoneDigits || mailerRow.phone,
  });
  const created = await createShapeLeadViaPost(payload);
  if (!created.created || !created.shape_lead_id) {
    return { error: created.error ?? 'Shape postlead failed', details: created };
  }

  await supabase
    .from('mailer_leads')
    .update({
      shape_lead_id: created.shape_lead_id,
      phone: formattedPhone ?? mailerRow.phone,
      shape_synced_at: new Date().toISOString(),
    })
    .eq('mailer_lead_id', mailerRow.mailer_lead_id);

  return { shapeLeadId: created.shape_lead_id, created: true };
}
