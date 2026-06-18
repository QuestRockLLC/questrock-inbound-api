import { findMailerLeadByPhone, findMailerLeadByReferenceCode } from './find-lead.js';
import { extractOfferCodeCandidates, extractPhoneCandidatesFromTranscript, transcriptMentionsMailer } from './offer-code.js';
import { formatPhoneNumber } from '../phone.js';

/**
 * Identify imported mailer lead from transcript text (offer code, callback phone).
 */
export async function matchMailerLeadFromTranscript(supabase, transcriptText, formattedPhone = null) {
  const result = {
    matched: false,
    mailerRow: null,
    reference_code: null,
    matched_by: null,
    callback_phone: formattedPhone ? formatPhoneNumber(formattedPhone) : null,
  };

  let mailerRow = result.callback_phone
    ? await findMailerLeadByPhone(supabase, result.callback_phone)
    : null;
  if (mailerRow) {
    result.matched_by = 'caller_phone';
  }

  if (!mailerRow) {
    for (const phone10 of extractPhoneCandidatesFromTranscript(transcriptText)) {
      mailerRow = await findMailerLeadByPhone(supabase, phone10);
      if (mailerRow) {
        result.callback_phone = formatPhoneNumber(phone10);
        result.matched_by = 'transcript_phone';
        break;
      }
    }
  }

  const codes = extractOfferCodeCandidates(transcriptText);
  if (!mailerRow && codes.length) {
    for (const code of codes) {
      mailerRow = await findMailerLeadByReferenceCode(supabase, code);
      if (mailerRow) {
        result.reference_code = code;
        result.matched_by = result.matched_by || 'transcript_offer_code';
        break;
      }
    }
  }

  if (mailerRow) {
    result.matched = true;
    result.mailerRow = mailerRow;
    result.reference_code = result.reference_code || mailerRow.reference_code;
  }

  return result;
}

export function isQuestMailTranscript(text, callChannel) {
  return callChannel === 'questmail' || transcriptMentionsMailer(text);
}
