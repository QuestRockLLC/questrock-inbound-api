const DEFAULT_SHAPE_PROSPECT_BASE_URL = 'https://secure.setshape.com/prospects';

export function getShapeProspectBaseUrl() {
  const base = String(process.env.SHAPE_PROSPECT_BASE_URL || DEFAULT_SHAPE_PROSPECT_BASE_URL).trim();
  return base.replace(/\/$/, '');
}

/**
 * Opens a Shape lead in the CRM editor (prospects/{id}/edit).
 */
export function buildShapeProspectUrl(shapeLeadId) {
  const id = String(shapeLeadId ?? '').trim();
  if (!id || !/^\d+$/.test(id)) {
    return null;
  }

  return `${getShapeProspectBaseUrl()}/${id}/edit`;
}
