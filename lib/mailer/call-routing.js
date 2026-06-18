import { findMailerLeadByPhone } from './find-lead.js';
import { borrowerPhoneFromCallerId } from '../phone.js';

/**
 * QuestMail at call-answer: only link when caller ID is a real borrower cell on file.
 * Never create a placeholder Shape lead — wait for transcript to identify offer code.
 */
export async function resolveQuestMailAtCallAnswered(supabase, {
  phoneDigits,
  firstName,
  lastName,
  formattedPhone,
  callerPhoneRaw,
}) {
  const borrowerPhone = borrowerPhoneFromCallerId(callerPhoneRaw ?? formattedPhone);
  let mailerRow = null;

  if (borrowerPhone) {
    mailerRow = await findMailerLeadByPhone(supabase, borrowerPhone);
  }

  if (mailerRow?.shape_lead_id) {
    return {
      deferred: false,
      shapeLeadId: String(mailerRow.shape_lead_id),
      contactFound: true,
      created: false,
      mailerLead: mailerRow,
      borrowerPhone,
    };
  }

  if (mailerRow) {
    return {
      deferred: true,
      shapeLeadId: null,
      contactFound: false,
      created: false,
      mailerLead: mailerRow,
      borrowerPhone,
      reason: 'mailer_row_found_awaiting_transcript_for_shape_link',
    };
  }

  return {
    deferred: true,
    shapeLeadId: null,
    contactFound: false,
    created: false,
    mailerLead: null,
    borrowerPhone,
    reason: 'questmail_awaiting_transcript_identification',
  };
}
