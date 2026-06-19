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
import { searchMailerLeads } from '../mailer-lo/search.js';

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

  if (!mailerRow) {
    const address = extractAddressHintsFromTranscript(transcriptText);
    const names = extractBorrowerNameHints(transcriptText);
    const searchQueries = [
      [address.street, address.city, address.state, address.zip].filter(Boolean).join(' '),
      [address.city, address.state, address.zip].filter(Boolean).join(' '),
      address.zip,
    ].filter((query) => query && String(query).length >= 2);

    for (const query of searchQueries) {
      const results = await searchMailerLeads(supabase, query, { limit: 15 });
      if (!results.length) {
        continue;
      }

      if (address.street) {
        const streetNumber = address.street.match(/^\d+/)?.[0];
        const streetCore = address.street.toLowerCase().replace(/^\d+\s+/, '');
        const byStreet = results.filter((row) => {
          const addr = String(row.address_line_1 ?? '').toLowerCase();
          return (
            addr.includes(address.street.toLowerCase()) ||
            (streetNumber && addr.startsWith(`${streetNumber} `)) ||
            (streetCore && addr.includes(streetCore))
          );
        });

        if (byStreet.length === 1) {
          mailerRow = byStreet[0];
          result.matched_by = 'transcript_search_street';
          break;
        }

        for (const row of byStreet) {
          for (const name of names) {
            if (nameMatchesMailerRow(name, row)) {
              mailerRow = row;
              result.matched_by = 'transcript_search_street_name';
              break;
            }
          }
          if (mailerRow) break;
        }
        if (mailerRow) break;
      }

      for (const row of results) {
        for (const name of names) {
          if (nameMatchesMailerRow(name, row)) {
            mailerRow = row;
            result.matched_by = 'transcript_search_name';
            break;
          }
        }
        if (mailerRow) break;
      }
      if (mailerRow) break;

      if (results.length === 1 && address.zip && query.includes(address.zip)) {
        mailerRow = results[0];
        result.matched_by = 'transcript_search_zip_unique';
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
