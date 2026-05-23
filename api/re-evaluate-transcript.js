import {
  getSupabaseClient,
  reEvaluateLatestForLead,
  reEvaluateTranscriptById,
} from '../lib/evaluate-transcript.js';
import { assertAuthorized, readJsonBody, sendJson } from '../lib/http.js';

/**
 * POST /api/re-evaluate-transcript
 *
 * Re-runs AI on existing Supabase transcript(s) without creating new rows.
 *
 * Body (one of):
 *   { "transcript_id": "uuid" }           — re-eval one row; updates lead if it's the latest
 *   { "lead_id": "uuid" }                   — re-eval latest transcript for lead
 *   { "shape_lead_id": "49551" }            — re-eval latest transcript for Shape lead
 *   { "transcript_ids": ["uuid", ...] }     — batch re-eval (lead updated from newest in batch)
 */
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return sendJson(res, 405, { error: 'Method Not Allowed' });
  }

  try {
    assertAuthorized(req);

    const body = readJsonBody(req);
    const supabase = getSupabaseClient();
    const loName = body.lo_name ?? body.loName ?? null;

    if (Array.isArray(body.transcript_ids) && body.transcript_ids.length) {
      const results = [];

      for (const id of body.transcript_ids) {
        results.push(await reEvaluateTranscriptById(supabase, String(id).trim(), { loName }));
      }

      return sendJson(res, 200, {
        re_evaluated: true,
        count: results.length,
        results,
      });
    }

    if (body.transcript_id) {
      const result = await reEvaluateTranscriptById(supabase, String(body.transcript_id).trim(), {
        loName,
      });

      return sendJson(res, 200, { re_evaluated: true, ...result });
    }

    if (body.lead_id || body.shape_lead_id) {
      const result = await reEvaluateLatestForLead(supabase, {
        leadId: body.lead_id ? String(body.lead_id).trim() : null,
        shapeLeadId: body.shape_lead_id ? String(body.shape_lead_id).trim() : null,
        loName,
      });

      return sendJson(res, 200, { re_evaluated: true, ...result });
    }

    return sendJson(res, 400, {
      error: 'Provide transcript_id, transcript_ids, lead_id, or shape_lead_id.',
    });
  } catch (error) {
    console.error('[re-evaluate-transcript] failed:', error);

    const statusCode = error.statusCode ?? 500;
    const message =
      statusCode === 500 ? 'Internal Server Error' : error.message ?? 'Request failed';

    return sendJson(res, statusCode, { error: message });
  }
}

export const config = {
  maxDuration: 300,
};
