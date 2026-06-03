import { getSupabaseClient } from '../../lib/supabase.js';
import { assertLoDeskAuthorized } from '../../lib/mailer-lo/auth.js';
import { assignMailerLeadToLo } from '../../lib/mailer-lo/assign.js';
import { readJsonBody, sendJson } from '../../lib/http.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return sendJson(res, 405, { ok: false, error: 'Method not allowed.' });
  }

  try {
    const body = readJsonBody(req);
    assertLoDeskAuthorized(req, body);

    const result = await assignMailerLeadToLo(getSupabaseClient(), {
      referenceCode: body.reference_code ?? body.referenceCode,
      mailerLeadId: body.mailer_lead_id ?? body.mailerLeadId,
      loName: body.lo_name ?? body.loName,
      note: body.note,
    });

    return sendJson(res, 200, { ok: true, ...result });
  } catch (error) {
    return sendJson(res, error.statusCode || 500, {
      ok: false,
      error: error.message || 'Assign failed.',
      auth_hint: error.authHint,
    });
  }
}
