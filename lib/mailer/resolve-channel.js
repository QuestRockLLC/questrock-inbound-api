import { normalizePhoneDigits } from '../phone.js';
import { matchQuestMailDid } from './questmail-dids.js';
import { matchInboundLandingDid } from './inbound-landing-dids.js';

const PHONE_KEY_RE = /phone|number|did|dialed|called|callee|caller|forward/i;

function addCandidate(set, value) {
  const digits = normalizePhoneDigits(value);
  if (digits.length >= 10) {
    set.add(digits.length > 10 ? digits.slice(-10) : digits);
  }
}

/** Every phone-like value on the Zoom webhook — toll-free may appear on any of these. */
export function collectDialedPhoneCandidates(zoom, body) {
  const set = new Set();

  for (const value of [
    zoom?.calleePhone,
    zoom?.calleeNumber,
    zoom?.dialedNumber,
    zoom?.ownerExtension,
    body?.callee_phone,
    body?.dialed_number,
    body?.to_number,
    body?.called_number,
  ]) {
    addCandidate(set, value);
  }

  const payloadObject = body?.payload?.object ?? {};
  addCandidate(set, payloadObject.callee?.phone_number);
  addCandidate(set, payloadObject.callee?.phoneNumber);
  addCandidate(set, payloadObject.forwarded_to?.phone_number);
  addCandidate(set, payloadObject.forwarded_from?.phone_number);
  addCandidate(set, payloadObject.redirect_forward?.phone_number);

  function walk(node, depth = 0) {
    if (!node || depth > 6) return;
    if (typeof node === 'string' || typeof node === 'number') {
      addCandidate(set, node);
      return;
    }
    if (Array.isArray(node)) {
      for (const item of node) walk(item, depth + 1);
      return;
    }
    if (typeof node === 'object') {
      for (const [key, value] of Object.entries(node)) {
        if (PHONE_KEY_RE.test(key)) {
          addCandidate(set, value);
        }
        walk(value, depth + 1);
      }
    }
  }

  walk(body?.payload);
  walk(body);

  return [...set];
}

/**
 * Classify inbound Zoom calls: QuestMail toll-free vs state landing page vs generic inbound ads.
 * QuestMail is identified by the toll-free number on the mail piece (not the landing page forward target).
 */
export function resolveInboundCallChannel(zoom, body = {}) {
  const candidates = collectDialedPhoneCandidates(zoom, body);

  for (const phone10 of candidates) {
    const match = matchQuestMailDid(phone10);
    if (match) {
      return {
        channel: 'questmail',
        shapeSource: 'mail',
        shapeSourceId: process.env.SHAPE_MAILER_SOURCE_ID || '21580',
        questmail: match,
        landing: null,
        utmCampaign: null,
        dialedNumber: phone10,
        matchedBy: 'questmail_toll',
      };
    }
  }

  for (const phone10 of candidates) {
    const landing = matchInboundLandingDid(phone10);
    if (landing) {
      return {
        channel: 'inbound_zoom',
        shapeSource: 'inbound_zoom',
        shapeSourceId: process.env.SHAPE_INBOUND_SOURCE_ID || '21571',
        questmail: null,
        landing,
        utmCampaign: landing.utmCampaign || `${landing.state?.toLowerCase()}-landing-page`,
        dialedNumber: phone10,
        matchedBy: 'landing_page',
      };
    }
  }

  const dialed = candidates[0] ?? null;

  return {
    channel: 'inbound_zoom',
    shapeSource: 'inbound_zoom',
    shapeSourceId: process.env.SHAPE_INBOUND_SOURCE_ID || '21571',
    questmail: null,
    landing: null,
    utmCampaign: null,
    dialedNumber: dialed,
    matchedBy: 'default_inbound',
  };
}
