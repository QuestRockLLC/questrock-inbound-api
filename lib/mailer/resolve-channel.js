import { matchQuestMailDid } from './questmail-dids.js';
import { matchInboundLandingDid } from './inbound-landing-dids.js';

function calleeCandidates(zoom) {
  return [
    zoom.calleePhone,
    zoom.calleeNumber,
    zoom.dialedNumber,
    zoom.ownerExtension,
  ].filter(Boolean);
}

/**
 * Classify inbound Zoom calls: QuestMail callback vs state landing page vs generic inbound ads.
 */
export function resolveInboundCallChannel(zoom) {
  for (const candidate of calleeCandidates(zoom)) {
    const match = matchQuestMailDid(candidate);
    if (match) {
      return {
        channel: 'questmail',
        shapeSource: 'mail',
        shapeSourceId: process.env.SHAPE_MAILER_SOURCE_ID || '21580',
        questmail: match,
        landing: null,
        utmCampaign: null,
        dialedNumber: candidate,
      };
    }
  }

  for (const candidate of calleeCandidates(zoom)) {
    const landing = matchInboundLandingDid(candidate);
    if (landing) {
      return {
        channel: 'inbound_zoom',
        shapeSource: 'inbound_zoom',
        shapeSourceId: process.env.SHAPE_INBOUND_SOURCE_ID || '21571',
        questmail: null,
        landing,
        utmCampaign: landing.utmCampaign || `${landing.state?.toLowerCase()}-landing-page`,
        dialedNumber: candidate,
      };
    }
  }

  const dialed = calleeCandidates(zoom)[0] ?? null;

  return {
    channel: 'inbound_zoom',
    shapeSource: 'inbound_zoom',
    shapeSourceId: process.env.SHAPE_INBOUND_SOURCE_ID || '21571',
    questmail: null,
    landing: null,
    utmCampaign: null,
    dialedNumber: dialed,
  };
}
