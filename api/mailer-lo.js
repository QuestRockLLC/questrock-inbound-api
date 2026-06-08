import { getSupabaseClient } from '../lib/supabase.js';
import { assertLoDeskAuthorized } from '../lib/mailer-lo/auth.js';
import { searchMailerLeads } from '../lib/mailer-lo/search.js';
import {
  buildLeadBrief,
  buildLeadScript,
  getMailerLeadDetail,
} from '../lib/mailer-lo/lead-detail.js';
import { assignMailerLeadToLo } from '../lib/mailer-lo/assign.js';
import { getActiveMailerCampaign } from '../lib/mailer-lo/campaigns.js';
import { getShapeLoRoster } from '../lib/shape/lo-roster.js';
import { readJsonBody, sendJson } from '../lib/http.js';

function resolveAction(req) {
  const fromQuery = String(req.query?.action ?? '').trim().toLowerCase();
  if (fromQuery) {
    return fromQuery;
  }

  const url = String(req.url ?? '');
  const match = url.match(/\/api\/mailer-lo\/([^/?]+)/i);
  if (match?.[1]) {
    return match[1].toLowerCase();
  }

  return '';
}

export default async function handler(req, res) {
  const action = resolveAction(req);

  if (action === 'search') {
    if (req.method !== 'GET') {
      res.setHeader('Allow', 'GET');
      return sendJson(res, 405, { ok: false, error: 'Method not allowed.' });
    }

    try {
      assertLoDeskAuthorized(req, {
        import_secret: req.query?.import_secret ?? req.query?.importSecret,
      });

      const q = String(req.query?.q ?? '').trim();
      const results = await searchMailerLeads(getSupabaseClient(), q);

      return sendJson(res, 200, { ok: true, query: q, count: results.length, results });
    } catch (error) {
      return sendJson(res, error.statusCode || 500, {
        ok: false,
        error: error.message || 'Search failed.',
        auth_hint: error.authHint,
      });
    }
  }

  if (action === 'lead') {
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

  if (action === 'assign') {
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

      const status = result.ok === false ? 422 : 200;
      return sendJson(res, status, result);
    } catch (error) {
      return sendJson(res, error.statusCode || 500, {
        ok: false,
        error: error.message || 'Assign failed.',
        auth_hint: error.authHint,
      });
    }
  }

  if (action === 'roster') {
    if (req.method !== 'GET') {
      res.setHeader('Allow', 'GET');
      return sendJson(res, 405, { ok: false, error: 'Method not allowed.' });
    }

    try {
      assertLoDeskAuthorized(req, {
        import_secret: req.query?.import_secret ?? req.query?.importSecret,
      });

      return sendJson(res, 200, {
        ok: true,
        roster: getShapeLoRoster(),
      });
    } catch (error) {
      return sendJson(res, error.statusCode || 500, {
        ok: false,
        error: error.message || 'Failed to load LO roster.',
        auth_hint: error.authHint,
      });
    }
  }

  if (action === 'campaign') {
    if (req.method !== 'GET') {
      res.setHeader('Allow', 'GET');
      return sendJson(res, 405, { ok: false, error: 'Method not allowed.' });
    }

    try {
      assertLoDeskAuthorized(req, {
        import_secret: req.query?.import_secret ?? req.query?.importSecret,
      });

      const campaign = await getActiveMailerCampaign(getSupabaseClient());

      return sendJson(res, 200, { ok: true, campaign });
    } catch (error) {
      return sendJson(res, error.statusCode || 500, {
        ok: false,
        error: error.message || 'Failed to load campaign.',
        auth_hint: error.authHint,
      });
    }
  }

  return sendJson(res, 404, {
    ok: false,
    error: 'Unknown mailer-lo action. Use search, lead, assign, roster, or campaign.',
  });
}
