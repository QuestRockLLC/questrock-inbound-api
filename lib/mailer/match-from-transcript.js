import { findMailerLeadByPhone, findMailerLeadByReferenceCode, MAILER_ROW_SELECT } from './find-lead.js';
import { findMailerLeadByAddress, findMailerLeadByNameAndZip, findMailerLeadById } from './find-lead-by-address.js';
import { extractOfferCodeCandidates, extractPhoneCandidatesFromTranscript, transcriptMentionsMailer } from './offer-code.js';
import {
  extractAddressHintsFromTranscript,
  extractBorrowerNameHints,
  extractSpokenCallbackPhones,
  nameMatchesMailerRow,
} from './transcript-address.js';
import { formatPhoneNumber } from '../phone.js';

/**
 * Identify imported mailer lead from transcript text (offer code, callback phone, address, name).
 */
export async function matchMailerLeadFromTranscript(
  supabase,
  transcriptText,
  formattedPhone = null,
  hints = {},
) {
  const result = {
    matched: false,
    mailerRow: null,
    reference_code: null,
    matched_by: null,
    callback_phone: formattedPhone ? formatPhoneNumber(formattedPhone) : null,
  };

  const hintCodes = [
    hints.referenceCode,
    hints.reference_code,
    hints.leadReferenceCode,
    hints.mailerLeadId ? null : null,
  ].filter(Boolean);

  for (const code of hintCodes) {
    const mailerRow = await findMailerLeadByReferenceCode(supabase, code);
    if (mailerRow) {
      result.matched = true;
      result.mailerRow = mailerRow;
      result.reference_code = mailerRow.reference_code;
      result.matched_by = 'reference_code_hint';
      return result;
    }
  }

  if (hints.mailerLeadId) {
    const mailerRow = await findMailerLeadById(supabase, hints.mailerLeadId);
    if (mailerRow) {
      result.matched = true;
      result.mailerRow = mailerRow;
      result.reference_code = mailerRow.reference_code;
      result.matched_by = 'mailer_lead_id_hint';
      return result;
    }
  }

  let mailerRow = result.callback_phone
    ? await findMailerLeadByPhone(supabase, result.callback_phone)
    : null;
  if (mailerRow) {
    result.matched_by = 'caller_phone';
  }

  const phoneCandidates = [
    ...extractPhoneCandidatesFromTranscript(transcriptText),
    ...extractSpokenCallbackPhones(transcriptText),
  ];

  if (!mailerRow) {
    for (const phone10 of phoneCandidates) {
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

  if (!mailerRow) {
    const address = extractAddressHintsFromTranscript(transcriptText);
    mailerRow = await findMailerLeadByAddress(supabase, address);
    if (mailerRow) {
      result.matched_by = 'transcript_address';
    }
  }

  if (!mailerRow) {
    const address = extractAddressHintsFromTranscript(transcriptText);
    const names = extractBorrowerNameHints(transcriptText);
    for (const name of names) {
      mailerRow = await findMailerLeadByNameAndZip(supabase, name, address.zip);
      if (mailerRow) {
        result.matched_by = 'transcript_name_zip';
        break;
      }
    }
  }

  if (!mailerRow) {
    const address = extractAddressHintsFromTranscript(transcriptText);
    if (address.zip) {
      const { data } = await supabase
        .from('mailer_leads')
        .select(MAILER_ROW_SELECT)
        .eq('zip_code', address.zip)
        .order('imported_at', { ascending: false })
        .limit(10);
      const names = extractBorrowerNameHints(transcriptText);
      for (const row of data ?? []) {
        for (const name of names) {
          if (nameMatchesMailerRow(name, row)) {
            mailerRow = row;
            result.matched_by = 'transcript_name_fuzzy_zip';
            break;
          }
        }
        if (mailerRow) break;
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
