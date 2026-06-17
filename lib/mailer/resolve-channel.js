import { matchQuestMailDid } from './questmail-dids.js';

/**
 * Classify inbound Zoom calls: QuestMail callback vs paid/organic inbound ads line.
 * QuestMail = borrower dialed a toll-free number printed on weekly mail.
 */
export function resolveInboundCallChannel(zoom) {
  const calleeCandidates = [
    zoom.calleePhone,
    zoom.calleeNumber,
    zoom.dialedNumber,
    zoom.ownerExtension,
  ];

  for (const candidate of calleeCandidates) {
    const match = matchQuestMailDid(candidate);
    if (match) {
      return {
        channel: 'questmail',
        shapeSource: 'mail',
        shapeSourceId: process.env.SHAPE_MAILER_SOURCE_ID || '21580',
        questmail: match,
      };
    }
  }

  return {
    channel: 'inbound_zoom',
    shapeSource: 'inbound_zoom',
    shapeSourceId: process.env.SHAPE_INBOUND_SOURCE_ID || '21571',
    questmail: null,
  };
}
