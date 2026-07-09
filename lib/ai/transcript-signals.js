/**
 * Lightweight pattern hints appended to the AI user prompt (not hard overrides).
 * Shape CRM allows only: Advanced, Not Contacted, Did Not Advance, Bad Lead, Turndown.
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
      'PRE-APPROVAL / APPROVAL LETTER sent or promised on this call — status should be Advanced.',
    );
  }

  if (
    /(?:link to an application|application link|loan application|fill out the application|sent it over to you|send you over an email.*application|email.*application|send (?:you )?(?:the )?(?:application|documentation|docs))/i.test(
      text,
    )
  ) {
    signals.push(
      'APPLICATION / DOCUMENTATION path on this call — status should be Advanced when borrower shows interest.',
    );
  }

  if (
    /(?:try to send|send (?:it )?(?:today|tomorrow)|complete (?:the )?application|fill (?:it )?out|get (?:it )?(?:back|over) to you)/i.test(
      lower,
    ) &&
    /(?:application|documentation|docs|email)/i.test(lower)
  ) {
    signals.push(
      'BORROWER agreed to send app/docs or complete soon — status should be Advanced (forward intent).',
    );
  }

  if (
    /(?:don'?t|do not|doesn'?t) qualify right now|not qualify right now|wouldn'?t qualify right now/i.test(
      lower,
    ) &&
    /(?:month|save|savings|season|6 month|follow up|call me when|work with that)/i.test(lower) &&
    !/(application|send (?:you|it)|fill out|today|tomorrow)/i.test(lower)
  ) {
    signals.push(
      'NOT QUALIFIED NOW + distant future only — consider Did Not Advance (nurture hold).',
    );
  }

  if (
    /(?:divorce|attorney next week|legal|served the paper|waiting on)/i.test(lower) &&
    /(?:refinance|pre-approval|financ)/i.test(lower) &&
    !/pre-approval letter|shoot you.*approval|application|send (?:you|it)/i.test(lower)
  ) {
    signals.push(
      'Legal/divorce timeline blocking near-term progress — Did Not Advance unless follow-up or docs agreed.',
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

  if (
    /(?:circle back|call you back|follow up|callback|get back to you|reach out|touch base)/i.test(
      lower,
    ) &&
    /(?:interest|refinanc|mortgage|application|send|today|tomorrow|letter|rate|payment)/i.test(
      lower,
    )
  ) {
    signals.push(
      'MUTUAL FOLLOW-UP or forward path on an engaged call — lean Advanced unless borrower clearly refused.',
    );
  }

  if (/(wrong number|not the person|stop calling|do not call|don'?t call again)/i.test(lower)) {
    signals.push('DECLINE / DNC / wrong number — consider Turndown or Bad Lead.');
  }

  return signals;
}

export function formatTranscriptSignalsBlock(signals) {
  if (!signals.length) {
    return '';
  }

  return `\nAUTOMATED SIGNAL HINTS (verify against transcript — these are suggestions, not overrides):\n${signals.map((s) => `• ${s}`).join('\n')}\n`;
}
