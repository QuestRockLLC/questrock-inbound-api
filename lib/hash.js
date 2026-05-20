import { createHash } from 'node:crypto';

/**
 * Builds a deterministic SHA-256 hash for transcript chain integrity.
 */
export function createTranscriptHash(parts) {
  const payload = parts
    .filter((part) => part !== undefined && part !== null && String(part).trim() !== '')
    .map((part) => String(part))
    .join(':');

  return createHash('sha256').update(payload, 'utf8').digest('hex');
}

/**
 * Hash for the first event on a call (call answered placeholder).
 */
export function createInitialCallHash({ externalCallId, leadId }) {
  return createTranscriptHash(['call-answered', externalCallId, leadId]);
}

/**
 * Hash for a transcript append that chains off the previous row.
 */
export function createChainedTranscriptHash({
  externalCallId,
  leadId,
  previousHash,
  transcriptText,
  callSource,
}) {
  return createTranscriptHash([
    callSource,
    externalCallId,
    leadId,
    previousHash,
    transcriptText,
  ]);
}
