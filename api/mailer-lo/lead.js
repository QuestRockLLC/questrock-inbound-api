import { getSupabaseClient } from '../../lib/supabase.js';
import { assertLoDeskAuthorized } from '../../lib/mailer-lo/auth.js';
import {
  buildLeadBrief,
  buildLeadScript,
  getMailerLeadDetail,
} from '../../lib/mailer-lo/lead-detail.js';
import { sendJson } from '../../lib/http.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return sendJson(res, 405, { ok: false, error: 'Method not allowed.' });
  }

  try {
    assertLoDeskAuthorized(req, {
      import_secret: req.query?.import_secret ?? req.query?.importSecret,
    });

    const referenceCode = req.query?.reference_code ?? req.query?.referenceCode;
    const mailerLeadId = req.query?.mailer_lead_id ?? req.query?.mailerLeadId;
    const loName = req.query?.lo_name ?? req.query?.loName ?? '';

    if (!referenceCode && !mailerLeadId) {
      return sendJson(res, 400, {
        ok: false,
        error: 'Provide reference_code or mailer_lead_id.',
      });
    }

    const detail = await getMailerLeadDetail(getSupabaseClient(), {
      referenceCode,
      mailerLeadId,
    });

    if (!detail) {
      return sendJson(res, 404, { ok: false, error: 'Lead not found.' });
    }

    return sendJson(res, 200, {
      ok: true,
      ...detail,
      brief: buildLeadBrief(detail.mailer_lead),
      call_script: buildLeadScript(detail.mailer_lead, loName),
    });
  } catch (error) {
    return sendJson(res, error.statusCode || 500, {
      ok: false,
      error: error.message || 'Failed to load lead.',
      auth_hint: error.authHint,
    });
  }
}
