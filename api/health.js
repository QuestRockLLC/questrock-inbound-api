import { getSupabaseClient } from '../lib/supabase.js';
import { sendJson } from '../lib/http.js';

/**
 * GET /api/health — deployment smoke test (no auth required).
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
  };

  let supabaseOk = false;

  if (checks.supabase_url && checks.supabase_service_role) {
    try {
      const supabase = getSupabaseClient();
      const { error } = await supabase.from('status_definitions').select('status_label').limit(1);
      supabaseOk = !error;
      if (error) {
        checks.supabase_error = error.message;
      }
    } catch (error) {
      checks.supabase_error = error.message;
    }
  }

  const ready = checks.supabase_url && checks.supabase_service_role && supabaseOk;

  return sendJson(res, ready ? 200 : 503, {
    ok: ready,
    service: 'inboundnewprocess',
    checks: { ...checks, supabase_connectivity: supabaseOk },
    endpoints: [
      'POST /api/call-answered',
      'POST /api/zoom-transcript',
      'POST /api/lo-note',
    ],
  });
}
