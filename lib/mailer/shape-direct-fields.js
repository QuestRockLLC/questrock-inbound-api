import { buildShapeLeadPayload } from './normalize.js';
import { normalizePhoneDigits } from '../phone.js';

export function buildDirectShapeFields(payload) {
  const fields = {};

  if (payload.formattedPhone) {
    fields.phone = payload.formattedPhone;
  }

  if (payload.fullName) {
    const parts = String(payload.fullName).trim().split(/\s+/);
    if (parts[0]) {
      fields.firstname = parts[0];
    }
    if (parts.length > 1) {
      fields.lastname = parts.slice(1).join(' ');
    }
  }

  return fields;
}

export function mailerDirectShapeFields(mailerRow, formattedPhone) {
  const payload = buildShapeLeadPayload({
    ...mailerRow,
    phone: formattedPhone ? normalizePhoneDigits(formattedPhone) : mailerRow.phone,
  });
  const fields = { ...payload };
  delete fields.notes_sidebar;
  delete fields.mstrstatus1;
  delete fields.referralsource;
  return fields;
}
