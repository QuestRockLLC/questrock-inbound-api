import { getSupabaseClient } from '../lib/supabase.js';
import { assertAuthorized, sendJson } from '../lib/http.js';

function supabaseProjectHost() {
  try {
    return process.env.SUPABASE_URL ? new URL(process.env.SUPABASE_URL).host : null;
  } catch {
    return null;
  }
}

/**
 * GET /api/health — deployment smoke test (no auth required).
 * Optional: ?lead_id=uuid or ?shape_lead_id=49332 (requires x-zapier-secret if set).
 */
export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return sendJson(res, 405, { error: 'Method Not Allowed' });
  }

  const checks = {
    supabase_url: Boolean(process.env.SUPABASE_URL),
    supabase_service_role: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),
    openai_api_key: Boolean(process.env.OPENAI_API_KEY),
    supabase_project_host: supabaseProjectHost(),
  };

  let supabaseOk = false;
  let rowCounts = null;

  if (checks.supabase_url && checks.supabase_service_role) {
    try {
      const supabase = getSupabaseClient();
      const { error } = await supabase.from('status_definitions').select('status_label').limit(1);
      supabaseOk = !error;
      if (error) {
        checks.supabase_error = error.message;
      }

      const { count: leadsCount } = await supabase
        .from('leads')
        .select('*', { count: 'exact', head: true });
      const { count: transcriptsCount } = await supabase
        .from('transcripts')
        .select('*', { count: 'exact', head: true });

      rowCounts = {
        leads: leadsCount ?? 0,
        transcripts: transcriptsCount ?? 0,
      };
    } catch (error) {
      checks.supabase_error = error.message;
    }
  }

  const ready = checks.supabase_url && checks.supabase_service_role && supabaseOk;

  const payload = {
    ok: ready,
    service: 'inboundnewprocess',
    checks: { ...checks, supabase_connectivity: supabaseOk },
    row_counts: rowCounts,
    endpoints: [
      'POST /api/call-answered',
      'POST /api/zoom-transcript',
      'POST /api/lo-note',
    ],
  };

  const leadId = req.query?.lead_id;
  const shapeLeadId = req.query?.shape_lead_id;

  if (leadId || shapeLeadId) {
    try {
      assertAuthorized(req);
      const supabase = getSupabaseClient();
      let query = supabase.from('leads').select('*, transcripts(transcript_id, call_source, timestamp, external_call_id)');

      if (leadId) {
        query = query.eq('lead_id', String(leadId));
      } else {
        query = query.eq('shape_lead_id', String(shapeLeadId));
      }

      const { data, error } = await query.maybeSingle();

      if (error) {
        payload.lookup_error = error.message;
      } else {
        payload.lookup = data;
      }
    } catch (error) {
      payload.lookup_error = error.message;
    }
  }

  return sendJson(res, ready ? 200 : 503, payload);
}
