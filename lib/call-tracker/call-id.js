/** @returns {boolean} */
export function isShapeTrackerCallId(callId) {
  return String(callId ?? '').startsWith('shape:');
}

/** Extract Shape numeric lead id from `shape:58335` or `shape:58335:created`. */
export function shapeLeadIdFromCallId(callId) {
  const raw = String(callId ?? '').trim();
  if (!raw.startsWith('shape:')) {
    return null;
  }
  const id = raw.replace(/^shape:/, '').replace(/:(created|transcript|answered)$/, '');
  return id || null;
}

export function shapeTrackerCallId(shapeLeadId) {
  return `shape:${String(shapeLeadId ?? '').trim()}`;
}

/** `:created` for Shape arrivals, `:answered` for Zoom calls. */
export function callAnchorSuffix(callId) {
  return isShapeTrackerCallId(callId) ? ':created' : ':answered';
}
