/** Disposition portal slugs ↔ Shape Lead Status picklist labels. */
export const STATUS_SLUG_META = {
  advanced: {
    label: 'Advanced',
    shapeStatus: 'Advanced',
    category: 'Green',
  },
  did_not_advance: {
    label: 'Did Not Advance',
    shapeStatus: 'Did Not Advance',
    category: 'Yellow',
  },
  not_contacted: {
    label: 'Not Contacted',
    shapeStatus: 'Not Contacted',
    category: 'Yellow',
  },
  turndown: {
    label: 'Turndown',
    shapeStatus: 'Turndown',
    category: 'Red',
  },
  bad_lead: {
    label: 'Bad Lead',
    shapeStatus: 'Bad Lead',
    category: 'Red',
  },
  help_requested: {
    label: 'Help Requested',
    shapeStatus: 'Did Not Advance',
    category: 'Purple',
    helpFieldValue: 'Help Requested',
  },
};

/** AI / Shape status labels → disposition slug (first match wins). */
const SHAPE_LABEL_TO_SLUG = {
  Advanced: 'advanced',
  'Did Not Advance': 'did_not_advance',
  'Not Contacted': 'not_contacted',
  Turndown: 'turndown',
  'Bad Lead': 'bad_lead',
  // Legacy labels (pre-5-status migration) — map for old transcript rows + emails
  'First Call Appointment Scheduled': 'advanced',
  'Pitch Appointment Scheduled': 'advanced',
  'Pitched - Advance': 'advanced',
  'App Sent': 'advanced',
  'App Started': 'advanced',
  'Pre-Approved': 'advanced',
  'Pre-Qualified': 'advanced',
  'Long Term Nurture': 'did_not_advance',
  Contacted: 'help_requested',
  'Help Requested': 'help_requested',
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
