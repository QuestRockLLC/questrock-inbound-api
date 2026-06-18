import { createShapeLeadViaPost } from '../shape/client.js';
import { buildShapeLeadPayload } from './normalize.js';
import { findMailerLeadByPhone } from './find-lead.js';

/**
 * Resolve or create Shape lead for QuestMail callback (marketing source Mail / 21580).
 */
export async function resolveQuestMailShapeLead(supabase, {
  phoneDigits,
  firstName,
  lastName,
  formattedPhone,
}) {
  const mailerRow = await findMailerLeadByPhone(supabase, formattedPhone);

  if (mailerRow?.shape_lead_id) {
    return {
      shapeLeadId: String(mailerRow.shape_lead_id),
      contactFound: true,
      created: false,
      mailerLead: mailerRow,
      shapePost: { skipped: true, reason: 'Existing mailer Shape lead' },
    };
  }

  if (mailerRow) {
    const payload = buildShapeLeadPayload({
      ...mailerRow,
      phone: phoneDigits,
      first_name: mailerRow.first_name || firstName,
      last_name: mailerRow.last_name || lastName,
    });
    const created = await createShapeLeadViaPost(payload);
    if (!created.created || !created.shape_lead_id) {
      const error = new Error(created.error ?? 'Failed to create QuestMail Shape lead from mailer row');
      error.statusCode = 502;
      error.details = created;
      throw error;
    }

    await supabase
      .from('mailer_leads')
      .update({
        shape_lead_id: created.shape_lead_id,
        phone: formattedPhone,
        shape_synced_at: new Date().toISOString(),
      })
      .eq('mailer_lead_id', mailerRow.mailer_lead_id);

    return {
      shapeLeadId: created.shape_lead_id,
      contactFound: false,
      created: true,
      mailerLead: { ...mailerRow, shape_lead_id: created.shape_lead_id, phone: formattedPhone },
      shapePost: created,
    };
  }

  const created = await createShapeLeadViaPost({
    firstname: firstName || 'WIRELESS',
    lastname: lastName || 'CALLER',
    phone: phoneDigits,
    referralsource: 'QuestMail Callback',
    mktreferencecode: 'QUESTMAIL-CALLBACK',
    mstrstatus1: process.env.SHAPE_MAILER_DEFAULT_STATUS || 'New Lead',
    notes_sidebar:
      'QuestMail letter callback. Offer code not identified on answer — will link to the mailer record after the call transcript is processed.',
  });

  if (!created.created || !created.shape_lead_id) {
    const error = new Error(created.error ?? 'Failed to create QuestMail callback Shape lead');
    error.statusCode = 502;
    error.details = created;
    throw error;
  }

  return {
    shapeLeadId: created.shape_lead_id,
    contactFound: false,
    created: true,
    mailerLead: null,
    shapePost: created,
  };
}
