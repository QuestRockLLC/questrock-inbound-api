import { getSupabaseClient } from '../lib/supabase.js';
import { assertInboundSession } from '../lib/request-auth.js';
import { readJsonBody, sendJson } from '../lib/http.js';
import {
  archiveCall,
  deleteCall,
  renameCall,
  updateCallStatus,
} from '../lib/call-tracker/manage-call.js';

/**
 * POST /api/call-tracker-manage
 * Body: { action, call_id, ... }
 * Actions: archive | unarchive | delete | rename | update_status
 */
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return sendJson(res, 405, { ok: false, error: 'Method not allowed.' });
  }

  try {
    assertInboundSession(req, { requireCallTracker: true });

    const body = readJsonBody(req);
    const action = String(body?.action ?? '').trim().toLowerCase();
    const callId = String(body?.call_id ?? body?.callId ?? '').trim();

    if (!callId) {
      return sendJson(res, 400, { ok: false, error: 'call_id is required.' });
    }

    const supabase = getSupabaseClient();

    if (action === 'archive') {
      const result = await archiveCall(supabase, callId, { archived: true });
      return sendJson(res, 200, result);
    }

    if (action === 'unarchive') {
      const result = await archiveCall(supabase, callId, { archived: false });
      return sendJson(res, 200, result);
    }

    if (action === 'delete') {
      const result = await deleteCall(supabase, callId);
      return sendJson(res, 200, result);
    }

    if (action === 'rename') {
      const result = await renameCall(supabase, callId, body.borrower_name ?? body.borrowerName);
      return sendJson(res, 200, result);
    }

    if (action === 'update_status') {
      const result = await updateCallStatus(supabase, callId, {
        statusType: body.status_type ?? body.statusType,
        aiStatusLabel: body.ai_status_label ?? body.aiStatusLabel,
        loDispositionStatus: body.lo_disposition_status ?? body.loDispositionStatus,
        syncShape: Boolean(body.sync_shape ?? body.syncShape),
      });
      return sendJson(res, 200, result);
    }

    return sendJson(res, 400, {
      ok: false,
      error: 'action must be archive, unarchive, delete, rename, or update_status.',
    });
  } catch (error) {
    console.error('[call-tracker-manage] failed:', error);
    const statusCode = error.statusCode ?? 500;
    return sendJson(res, statusCode, {
      ok: false,
      error: statusCode === 500 ? 'Internal Server Error' : error.message,
    });
  }
}

export const config = {
  maxDuration: 30,
};
