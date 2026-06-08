import { getSupabaseClient } from '../lib/supabase.js';
import { answerArchiveChat, getArchiveChatMeta } from '../lib/shape/archive-chat.js';
import { assertImportAuthorized, readJsonBody, sendJson } from '../lib/http.js';

export default async function handler(req, res) {
  if (req.method === 'GET') {
    try {
      assertImportAuthorized(req, {
        import_secret: req.query?.import_secret ?? req.query?.importSecret,
      });

      const meta = await getArchiveChatMeta(getSupabaseClient(), {
        batchId: req.query?.batch_id ?? req.query?.batchId,
      });

      return sendJson(res, 200, { ok: true, ...meta });
    } catch (error) {
      return sendJson(res, error.statusCode || 500, {
        ok: false,
        error: error.message || 'Failed to load chat meta.',
        auth_hint: error.authHint,
      });
    }
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return sendJson(res, 405, { ok: false, error: 'Method not allowed.' });
  }

  try {
    const body = readJsonBody(req);
    assertImportAuthorized(req, body);

    const result = await answerArchiveChat(getSupabaseClient(), {
      message: body.message ?? body.query,
      history: body.history ?? [],
      batchId: body.batch_id ?? body.batchId,
    });

    return sendJson(res, 200, { ok: true, ...result });
  } catch (error) {
    return sendJson(res, error.statusCode || 500, {
      ok: false,
      error: error.message || 'Chat failed.',
      auth_hint: error.authHint,
    });
  }
}
