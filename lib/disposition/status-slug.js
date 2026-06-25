/** Disposition portal slugs ↔ Shape Lead Status picklist labels. */
export const STATUS_SLUG_META = {
  first_call_appt: {
    label: 'First Call Appt',
    shapeStatus: 'First Call Appointment Scheduled',
    category: 'Moving Forward',
  },
  pitch_appt: {
    label: 'Pitch Appt',
    shapeStatus: 'Pitch Appointment Scheduled',
    category: 'Moving Forward',
  },
  turndown: {
    label: 'Turndown',
    shapeStatus: 'Turndown',
    category: 'Dead / Denied',
  },
  missed_appt: {
    label: 'Missed Appt',
    shapeStatus: 'Missed Appt - Rescheduling',
    category: 'Dead / Denied',
  },
  not_contacted: {
    label: 'Not Contacted',
    shapeStatus: 'Not Contacted',
    category: 'Hold / Urgent',
  },
  help_requested: {
    label: 'Help Requested',
    shapeStatus: 'Contacted',
    category: 'Hold / Urgent',
    helpFieldValue: 'Help Requested',
  },
};

/** AI / Shape status labels → disposition slug (first match wins). */
const SHAPE_LABEL_TO_SLUG = {
  'First Call Appointment Scheduled': 'first_call_appt',
  'Pitch Appointment Scheduled': 'pitch_appt',
  Turndown: 'turndown',
  'Bad Lead': 'turndown',
  'Missed Appt - Rescheduling': 'missed_appt',
  'Not Contacted': 'not_contacted',
  'Did Not Advance': 'not_contacted',
  Contacted: 'help_requested',
  'Pre-Approved': 'first_call_appt',
  'Pitch Appt': 'pitch_appt',
  'First Call Appt': 'first_call_appt',
};

export function isValidDispositionSlug(slug) {
  return Boolean(slug && STATUS_SLUG_META[String(slug).trim()]);
}

export function slugFromShapeStatusLabel(label) {
  const normalized = String(label ?? '').trim();
  if (!normalized) return null;
  if (SHAPE_LABEL_TO_SLUG[normalized]) {
    return SHAPE_LABEL_TO_SLUG[normalized];
  }
  const lower = normalized.toLowerCase();
  for (const [shapeLabel, slug] of Object.entries(SHAPE_LABEL_TO_SLUG)) {
    if (shapeLabel.toLowerCase() === lower) {
      return slug;
    }
  }
  return null;
}

export function labelFromDispositionSlug(slug) {
  return STATUS_SLUG_META[slug]?.label ?? slug;
}

export function shapeStatusFromSlug(slug) {
  return STATUS_SLUG_META[slug]?.shapeStatus ?? null;
}
