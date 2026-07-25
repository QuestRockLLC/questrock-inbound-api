import { getQuestMailDids } from './questmail-dids.js';
import {
  findMailerLeadByPhone,
  findMailerLeadByReferenceCode,
  MAILER_ROW_SELECT,
} from './find-lead.js';
import { findLeadByShapeId, findLeadByPhone } from '../leads.js';
import { formatPhoneNumber } from '../phone.js';

const QUESTMAIL_LEAD_SOURCES = new Set(['questmail', 'mail']);

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 */
export async function findMailerLeadByShapeLeadId(supabase, shapeLeadId) {
  const id = String(shapeLeadId ?? '').trim();
  if (!id) {
    return null;
  }

  const { data, error } = await supabase
    .from('mailer_leads')
    .select(MAILER_ROW_SELECT)
    .eq('shape_lead_id', id)
    .order('imported_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data ?? null;
}

function questmailMetaForState(state) {
  const normalized = String(state ?? '').trim().toUpperCase();
  if (!normalized) {
    return { state: null, label: 'QuestMail', mailerType: null, phone10: null };
  }

  const match = getQuestMailDids().find((entry) => entry.state === normalized) ?? null;
  if (match) {
    return match;
  }

  return {
    state: normalized,
    label: `QuestMail ${normalized}`,
    mailerType: null,
    phone10: null,
  };
}

/**
 * When a QuestMail borrower calls back on a state landing line (not the toll-free),
 * link them to the mailer record so the call tracks as QuestMail, not Inbound Ads.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 */
export async function findQuestMailCallbackContext(supabase, { phoneDigits, shapeLeadId }) {
  let mailerLead = null;
  let inboundLead = null;
  let matchedBy = null;

  if (phoneDigits?.length === 10) {
    mailerLead = await findMailerLeadByPhone(supabase, phoneDigits);
    if (mailerLead) {
      matchedBy = 'mailer_phone';
    }
  }

  const shapeId = String(shapeLeadId ?? '').trim() || null;

  if (!mailerLead && shapeId) {
    mailerLead = await findMailerLeadByShapeLeadId(supabase, shapeId);
    if (mailerLead) {
      matchedBy = 'mailer_shape_lead_id';
    }
  }

  if (!mailerLead && phoneDigits?.length === 10) {
    const formatted = formatPhoneNumber(phoneDigits);
    const lead = formatted ? await findLeadByPhone(supabase, formatted) : null;
    if (lead && QUESTMAIL_LEAD_SOURCES.has(lead.lead_source)) {
      inboundLead = lead;
      matchedBy = 'inbound_lead_phone';
    }
  }

  if (!mailerLead && !inboundLead && shapeId) {
    const lead = await findLeadByShapeId(supabase, shapeId);
    if (lead && QUESTMAIL_LEAD_SOURCES.has(lead.lead_source)) {
      inboundLead = lead;
      matchedBy = 'inbound_lead_shape_id';

      if (lead.reference_code) {
        mailerLead = await findMailerLeadByReferenceCode(supabase, lead.reference_code);
      }
    }
  }

  if (!mailerLead && !inboundLead) {
    return null;
  }

  const state = mailerLead?.state ?? inboundLead?.state ?? null;

  return {
    mailerLead,
    inboundLead,
    matchedBy,
    questmailMeta: questmailMetaForState(state),
    shapeLeadId: mailerLead?.shape_lead_id ?? inboundLead?.shape_lead_id ?? shapeId,
    referenceCode: mailerLead?.reference_code ?? inboundLead?.reference_code ?? null,
  };
}

/**
 * Upgrade an inbound landing-page channel to QuestMail when caller is a known mailer lead.
 */
export function applyQuestMailCallbackToChannel(channelInfo, callbackContext) {
  if (!callbackContext || channelInfo?.channel === 'questmail') {
    return channelInfo;
  }

  return {
    ...channelInfo,
    channel: 'questmail',
    shapeSource: 'mail',
    shapeSourceId: process.env.SHAPE_MAILER_SOURCE_ID || '21580',
    questmail: callbackContext.questmailMeta,
    matchedBy: 'questmail_callback',
    callbackMatchedBy: callbackContext.matchedBy,
  };
}

/**
 * Resolve QuestMail routing when callback context already identified the mailer lead.
 */
export function resolveQuestMailFromCallbackContext(callbackContext) {
  const mailerLead = callbackContext?.mailerLead ?? null;
  const shapeLeadId = callbackContext?.shapeLeadId
    ? String(callbackContext.shapeLeadId).trim()
    : mailerLead?.shape_lead_id
      ? String(mailerLead.shape_lead_id).trim()
      : null;

  if (shapeLeadId) {
    return {
      deferred: false,
      shapeLeadId,
      contactFound: true,
      created: false,
      mailerLead,
      borrowerPhone: mailerLead?.phone ?? null,
      reason: `questmail_callback_${callbackContext.matchedBy}`,
    };
  }

  if (mailerLead) {
    return {
      deferred: true,
      shapeLeadId: null,
      contactFound: false,
      created: false,
      mailerLead,
      borrowerPhone: mailerLead?.phone ?? null,
      reason: 'questmail_callback_awaiting_transcript',
    };
  }

  return null;
}
