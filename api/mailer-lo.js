import { getSupabaseClient } from '../lib/supabase.js';
import { assertLoDeskAuthorized, assertLoDeskOrAdmin } from '../lib/mailer-lo/auth.js';
import {
  searchMailerLeads,
  listMailerLeadsForLo,
  listRecentMailerLeads,
} from '../lib/mailer-lo/search.js';
import {
  buildLeadBrief,
  buildLeadScript,
  getMailerLeadDetail,
} from '../lib/mailer-lo/lead-detail.js';
import { assignMailerLeadToLo } from '../lib/mailer-lo/assign.js';
import { getActiveMailerCampaign } from '../lib/mailer-lo/campaigns.js';
import { getShapeLoRoster } from '../lib/shape/lo-roster.js';
import { canAccessLead } from '../lib/inbound-access.js';
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

function loFilterForSession(session) {
  return session.isAdmin ? null : session.loName || null;
}

export default async function handler(req, res) {
  const action = resolveAction(req);

  if (action === 'my-leads') {
    if (req.method !== 'GET') {
      res.setHeader('Allow', 'GET');
      return sendJson(res, 405, { ok: false, error: 'Method not allowed.' });
    }

    try {
      const session = assertLoDeskAuthorized(req);
      const loName = session.loName;
      if (!loName && !session.isAdmin) {
        return sendJson(res, 403, { ok: false, error: 'Your account is not on the mailer LO roster.' });
      }

      const results = session.isAdmin
        ? await listRecentMailerLeads(getSupabaseClient(), { limit: 50 })
        : await listMailerLeadsForLo(getSupabaseClient(), loName, { limit: 50 });

      return sendJson(res, 200, {
        ok: true,
        loName: loName || null,
        count: results.length,
        results,
      });
    } catch (error) {
      return sendJson(res, error.statusCode || 500, {
        ok: false,
        error: error.message || 'Failed to load leads.',
      });
    }
  }

  if (action === 'search') {
    if (req.method !== 'GET') {
      res.setHeader('Allow', 'GET');
      return sendJson(res, 405, { ok: false, error: 'Method not allowed.' });
    }

    try {
      const session = assertLoDeskAuthorized(req);
      const q = String(req.query?.q ?? '').trim();
      const loName = loFilterForSession(session);
      const results = await searchMailerLeads(getSupabaseClient(), q, { loName });

      return sendJson(res, 200, { ok: true, query: q, count: results.length, results });
    } catch (error) {
      return sendJson(res, error.statusCode || 500, {
        ok: false,
        error: error.message || 'Search failed.',
      });
    }
  }

  if (action === 'lead') {
    if (req.method !== 'GET') {
      res.setHeader('Allow', 'GET');
      return sendJson(res, 405, { ok: false, error: 'Method not allowed.' });
    }

    try {
      const session = assertLoDeskAuthorized(req);

      const referenceCode = req.query?.reference_code ?? req.query?.referenceCode;
      const mailerLeadId = req.query?.mailer_lead_id ?? req.query?.mailerLeadId;
      const loName = req.query?.lo_name ?? req.query?.loName ?? session.loName ?? '';

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

      if (!canAccessLead(session, detail.mailer_lead)) {
        return sendJson(res, 403, { ok: false, error: 'This lead is assigned to another LO.' });
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
      });
    }
  }

  if (action === 'assign') {
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      return sendJson(res, 405, { ok: false, error: 'Method not allowed.' });
    }

    try {
      const session = assertLoDeskAuthorized(req);
      const body = readJsonBody(req);
      const loName = String(body.lo_name ?? body.loName ?? session.loName ?? '').trim();

      if (!loName) {
        return sendJson(res, 400, { ok: false, error: 'LO name is required.' });
      }

      if (!session.isAdmin && session.loName && loName !== session.loName) {
        return sendJson(res, 403, { ok: false, error: 'You can only assign leads to yourself.' });
      }

      const result = await assignMailerLeadToLo(getSupabaseClient(), {
        referenceCode: body.reference_code ?? body.referenceCode,
        mailerLeadId: body.mailer_lead_id ?? body.mailerLeadId,
        loName,
        note: body.note,
      });

      const status = result.ok === false ? 422 : 200;
      return sendJson(res, status, result);
    } catch (error) {
      return sendJson(res, error.statusCode || 500, {
        ok: false,
        error: error.message || 'Assign failed.',
      });
    }
  }

  if (action === 'roster') {
    if (req.method !== 'GET') {
      res.setHeader('Allow', 'GET');
      return sendJson(res, 405, { ok: false, error: 'Method not allowed.' });
    }

    try {
      assertLoDeskOrAdmin(req);
      return sendJson(res, 200, {
        ok: true,
        roster: getShapeLoRoster(),
      });
    } catch (error) {
      return sendJson(res, error.statusCode || 500, {
        ok: false,
        error: error.message || 'Failed to load LO roster.',
      });
    }
  }

  if (action === 'campaign') {
    if (req.method !== 'GET') {
      res.setHeader('Allow', 'GET');
      return sendJson(res, 405, { ok: false, error: 'Method not allowed.' });
    }

    try {
      assertLoDeskAuthorized(req);
      const campaign = await getActiveMailerCampaign(getSupabaseClient());
      return sendJson(res, 200, { ok: true, campaign });
    } catch (error) {
      return sendJson(res, error.statusCode || 500, {
        ok: false,
        error: error.message || 'Failed to load campaign.',
      });
    }
  }

  return sendJson(res, 404, {
    ok: false,
    error: 'Unknown mailer-lo action. Use my-leads, search, lead, assign, roster, or campaign.',
  });
}
