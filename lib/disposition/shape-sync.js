import { updateShapeLeadFields } from '../shape/client.js';
import { shapeStatusFromSlug, STATUS_SLUG_META } from './status-slug.js';

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function nlToBr(s) {
  return escapeHtml(s).replace(/\r\n/g, '\n').replace(/\n/g, '<br>');
}

/**
 * Apply LO disposition status + optional note to Shape.
 */
export async function syncLoDispositionToShape(shapeLeadId, { statusSlug, note, loName, leadName }) {
  const shapeStatus = shapeStatusFromSlug(statusSlug);
  if (!shapeStatus) {
    return { synced: false, skipped: true, reason: `Unknown disposition slug: ${statusSlug}` };
  }

  const fields = { mstrstatus1: shapeStatus };
  const meta = STATUS_SLUG_META[statusSlug];

  if (meta?.helpFieldValue && statusSlug === 'help_requested') {
    const helpField = process.env.SHAPE_LAUNCH_HELP_FIELD?.trim();
    if (helpField) {
      fields[helpField] = meta.helpFieldValue;
    }
  }

  const trimmedNote = String(note ?? '').trim();
  const sidebarLines = [
    '[LO DISPOSITION]',
    loName ? `LO: ${loName}` : null,
    leadName ? `Lead: ${leadName}` : null,
    `Status: ${shapeStatus}`,
  ];

  if (trimmedNote) {
    sidebarLines.push('', trimmedNote);
  }

  fields.notes_sidebar = sidebarLines.filter(Boolean).join('<br>');
  fields.recent_notes = trimmedNote
    ? `[LO DISPOSITION] ${shapeStatus}: ${trimmedNote}`.slice(0, 490)
    : `[LO DISPOSITION] ${shapeStatus}`.slice(0, 490);

  return updateShapeLeadFields(shapeLeadId, fields);
}
