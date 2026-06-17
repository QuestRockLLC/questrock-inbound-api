import { updateShapeLeadFields, createShapeLeadViaPost } from '../shape/client.js';
import { buildShapeLeadPayload } from './normalize.js';
import { extractOfferCodeCandidates, transcriptMentionsMailer } from './offer-code.js';
import { buildMailerReconcileAlertEmail } from './reconcile-email.js';
import { sendEmail } from '../email/send.js';

function shapeProspectUrl(shapeLeadId) {
  const base = (process.env.SHAPE_PROSPECT_BASE_URL || 'https://secure.setshape.com/prospects').replace(
    /\/$/,
    '',
  );
  return shapeLeadId ? `${base}/${shapeLeadId}` : null;
}

async function ensureMailerShapeLead(supabase, mailerRow, { phoneDigits, formattedPhone }) {
  if (mailerRow.shape_lead_id) {
    return { shapeLeadId: String(mailerRow.shape_lead_id), created: false };
  }

  const payload = buildShapeLeadPayload({
    ...mailerRow,
    phone: phoneDigits,
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

/**
 * After transcript: link call to mailer row, fix wrong inbound Shape lead, alert admin.
 */
export async function reconcileMailerFromTranscript(supabase, {
  lead,
  shapeLeadId,
  transcriptText,
  formattedPhone,
  callChannel,
  evaluation,
  skipShapeNote = false,
}) {
  const result = {
    checked: true,
    matched: false,
    action: 'none',
    mailer_lead_id: null,
    reference_code: null,
    wrong_shape_lead_id: null,
    correct_shape_lead_id: shapeLeadId,
    admin_alert: null,
  };

  const mentionsMailer = callChannel === 'questmail' || transcriptMentionsMailer(transcriptText);
  if (!mentionsMailer && callChannel !== 'questmail') {
    const codes = extractOfferCodeCandidates(transcriptText);
    if (!codes.length) {
      result.checked = false;
      result.reason = 'No mailer signals in transcript';
      return result;
    }
  }

  let mailerRow = formattedPhone ? await findMailerLeadByPhone(supabase, formattedPhone) : null;

  const codes = extractOfferCodeCandidates(transcriptText);
  if (!mailerRow && codes.length) {
    for (const code of codes) {
      mailerRow = await findMailerLeadByReferenceCode(supabase, code);
      if (mailerRow) {
        result.reference_code = code;
        break;
      }
    }
  }

  if (!mailerRow) {
    result.reason = mentionsMailer
      ? 'Mailer language detected but no mailer_leads row matched (phone or offer code)'
      : 'No mailer row found';
    if (mentionsMailer) {
      result.admin_alert = await sendMailerAlert({
        lead,
        shapeLeadId,
        transcriptText,
        evaluation,
        issue: result.reason,
        formattedPhone,
      });
    }
    return result;
  }

  result.matched = true;
  result.mailer_lead_id = mailerRow.mailer_lead_id;
  result.reference_code = result.reference_code || mailerRow.reference_code;

  const phoneDigits = formattedPhone?.replace(/\D/g, '').slice(-10);
  const ensured = await ensureMailerShapeLead(supabase, mailerRow, {
    phoneDigits,
    formattedPhone,
  });

  if (ensured.error) {
    result.action = 'error';
    result.error = ensured.error;
    result.admin_alert = await sendMailerAlert({
      lead,
      shapeLeadId,
      mailerRow,
      transcriptText,
      evaluation,
      issue: ensured.error,
      formattedPhone,
    });
    return result;
  }

  const correctShapeLeadId = ensured.shapeLeadId;
  result.correct_shape_lead_id = correctShapeLeadId;

  if (String(shapeLeadId) !== String(correctShapeLeadId)) {
    result.wrong_shape_lead_id = shapeLeadId;
    result.action = 'repointed';

    await supabase
      .from('leads')
      .update({
        shape_lead_id: correctShapeLeadId,
        lead_source: 'questmail',
        reference_code: mailerRow.reference_code,
        updated_at: new Date().toISOString(),
      })
      .eq('lead_id', lead.lead_id);

    await supabase
      .from('mailer_leads')
      .update({
        lead_id: lead.lead_id,
        phone: formattedPhone ?? mailerRow.phone,
        shape_lead_id: correctShapeLeadId,
        shape_synced_at: new Date().toISOString(),
      })
      .eq('mailer_lead_id', mailerRow.mailer_lead_id);

    result.admin_alert = await sendMailerAlert({
      lead,
      shapeLeadId,
      correctShapeLeadId,
      wrongShapeLeadId: shapeLeadId,
      mailerRow,
      transcriptText,
      evaluation,
      issue: `Duplicate inbound Shape lead #${shapeLeadId} — merged call data to mailer lead #${correctShapeLeadId}. Please archive/delete the stray inbound (21571) record in Shape.`,
      formattedPhone,
    });
  } else {
    result.action = 'confirmed';
    await supabase
      .from('leads')
      .update({
        lead_source: 'questmail',
        reference_code: mailerRow.reference_code,
        updated_at: new Date().toISOString(),
      })
      .eq('lead_id', lead.lead_id);
  }

  if (!skipShapeNote && evaluation?.callSummary) {
    await updateShapeLeadFields(correctShapeLeadId, {
      notes_sidebar: `QuestMail call (${mailerRow.reference_code}): ${evaluation.callSummary}`,
    });
  }

  result.shape_prospect_url = shapeProspectUrl(correctShapeLeadId);
  result.mailer_lo_desk_url = mailerRow.reference_code
    ? `https://questrock-inbound-api.vercel.app/mailer-lo/?q=${encodeURIComponent(mailerRow.reference_code)}`
    : null;

  return result;
}

async function sendMailerAlert(payload) {
  const email = buildMailerReconcileAlertEmail(payload);
  const send = await sendEmail({
    to: email.email_to,
    cc: email.email_cc,
    subject: email.email_subject,
    html: email.email_html,
  });
  return { ...email, send };
}
