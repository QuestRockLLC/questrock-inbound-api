import { updateShapeLeadFields } from '../shape/client.js';
import { matchMailerLeadFromTranscript } from './match-from-transcript.js';
import { ensureMailerShapeLeadForRow } from './ensure-mailer-shape-lead.js';
import { buildMailerReconcileAlertEmail } from './reconcile-email.js';
import { sendEmail } from '../email/send.js';

function shapeProspectUrl(shapeLeadId) {
  const base = (process.env.SHAPE_PROSPECT_BASE_URL || 'https://secure.setshape.com/prospects').replace(
    /\/$/,
    '',
  );
  return shapeLeadId ? `${base}/${shapeLeadId}` : null;
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

  const match = await matchMailerLeadFromTranscript(supabase, transcriptText, formattedPhone);
  if (!match.matched || !match.mailerRow) {
    result.reason =
      callChannel === 'questmail'
        ? 'Mailer call but no imported mailer lead matched (phone or offer code)'
        : 'No mailer row found';
    if (callChannel === 'questmail') {
      result.admin_alert = await sendMailerAlert({
        lead,
        shapeLeadId,
        transcriptText,
        evaluation,
        issue: result.reason,
        formattedPhone,
      });
    } else {
      result.checked = false;
    }
    return result;
  }

  const mailerRow = match.mailerRow;
  result.matched = true;
  result.mailer_lead_id = mailerRow.mailer_lead_id;
  result.reference_code = match.reference_code || mailerRow.reference_code;
  result.matched_by = match.matched_by;
  result.borrower_name =
    mailerRow.full_name ||
    [mailerRow.first_name, mailerRow.last_name].filter(Boolean).join(' ').trim() ||
    null;

  const callbackPhone = match.callback_phone || formattedPhone;
  const phoneDigits = callbackPhone?.replace(/\D/g, '').slice(-10);
  const ensured = await ensureMailerShapeLeadForRow(supabase, mailerRow, {
    phoneDigits,
    formattedPhone: callbackPhone,
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
      formattedPhone: callbackPhone,
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
        phone: callbackPhone ?? mailerRow.phone,
        shape_lead_id: correctShapeLeadId,
        shape_synced_at: new Date().toISOString(),
      })
      .eq('mailer_lead_id', mailerRow.mailer_lead_id);

    if (shapeLeadId) {
      result.admin_alert = await sendMailerAlert({
        lead,
        shapeLeadId,
        correctShapeLeadId,
        wrongShapeLeadId: shapeLeadId,
        mailerRow,
        transcriptText,
        evaluation,
        issue: `Duplicate inbound Shape lead #${shapeLeadId} — merged call data to mailer lead #${correctShapeLeadId}. Please archive/delete the stray inbound (21571) record in Shape.`,
        formattedPhone: callbackPhone,
      });
    }
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
    template: 'mailer_reconcile',
    meta: {
      shape_lead_id: payload.shapeLeadId,
      correct_shape_lead_id: payload.correctShapeLeadId,
      wrong_shape_lead_id: payload.wrongShapeLeadId,
      reference_code: payload.mailerRow?.reference_code,
    },
  });
  return { ...email, send };
}
