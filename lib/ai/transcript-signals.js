/**
 * Lightweight pattern hints appended to the AI user prompt (not hard overrides).
 */
export function detectTranscriptSignals(transcriptText) {
  const text = String(transcriptText ?? '');
  const lower = text.toLowerCase();
  const signals = [];

  const isVoicemail =
    /forwarded to voicemail|record your message|at the tone|not available\. at the tone/i.test(
      lower,
    ) && !/(yes,|yeah|my name|calling because|pre-approval|purchase|refinance)/i.test(lower);

  if (isVoicemail) {
    signals.push(
      'VOICEMAIL ONLY — no live conversation. Status should be Not Contacted, NOT Did Not Advance.',
    );
  }

  if (
    /pre-approval letter|pre approval letter|shoot you (?:out )?(?:the )?approval|send you (?:the )?approval|pre-approv/i.test(
      lower,
    )
  ) {
    signals.push(
      'PRE-APPROVAL LETTER offered or sent on this call — status should be Pre-Approved (green), NOT Did Not Advance.',
    );
  }

  if (
    /(?:don'?t|do not|doesn'?t) qualify right now|not qualify right now|wouldn'?t qualify right now/i.test(
      lower,
    ) &&
    /(?:month|save|savings|season|6 month|follow up|call me when|work with that)/i.test(lower)
  ) {
    signals.push(
      'NOT QUALIFIED NOW + agreed future plan — status should be Long Term Nurture, NOT Did Not Advance.',
    );
  }

  if (
    /(?:divorce|attorney next week|legal|served the paper|waiting on)/i.test(lower) &&
    /(?:refinance|pre-approval|financ)/i.test(lower) &&
    !/pre-approval letter|shoot you.*approval/i.test(lower)
  ) {
    signals.push(
      'Legal/divorce timeline blocking immediate progress — consider Long Term Nurture or Contacted, NOT First Call Appointment Scheduled unless a callback was explicitly scheduled.',
    );
  }

  const speakerTurns = (text.match(/\[\d{2}:\d{2}:\d{2}/g) ?? []).length;
  if (
    speakerTurns <= 2 &&
    /can i help you|this is .+ with quest/i.test(lower) &&
    text.length < 400
  ) {
    signals.push(
      'INCOMPLETE / ONE-SIDED call — LO greeting only or call dropped. Status should be Not Contacted.',
    );
  }

  if (/scheduled|callback|call you (?:back )?(?:at|around|between)|follow up (?:at|around)/i.test(lower)) {
    signals.push(
      'CALLBACK or follow-up time mentioned — if no pre-approval/app sent, First Call Appointment Scheduled may apply.',
    );
  }

  return signals;
}

export function formatTranscriptSignalsBlock(signals) {
  if (!signals.length) {
    return '';
  }

  return `\nAUTOMATED SIGNAL HINTS (verify against transcript — these are suggestions, not overrides):\n${signals.map((s) => `• ${s}`).join('\n')}\n`;
}
