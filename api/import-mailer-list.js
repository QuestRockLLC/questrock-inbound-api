import { getSupabaseClient } from '../lib/supabase.js';
import { importMailerRows } from '../lib/mailer/import.js';
import { normalizeMailerRows } from '../lib/mailer/normalize.js';
import { assertImportAuthorized, readJsonBody, sendJson } from '../lib/http.js';

export default async function handler(req, res) {
  if (req.method === 'GET') {
    try {
      assertImportAuthorized(req, null);
      const supabase = getSupabaseClient();
      const limit = Math.min(Number(req.query?.limit) || 10, 50);

      const { data: batches, error } = await supabase
        .from('mailer_import_batches')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(limit);

      if (error) {
        throw error;
      }

      return sendJson(res, 200, { ok: true, batches: batches ?? [] });
    } catch (error) {
      return sendJson(res, error.statusCode || 500, {
        ok: false,
        error: error.message || 'Failed to load import batches.',
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
    const rawRows = Array.isArray(body.rows) ? body.rows : [];
    const batchLabel = String(body.batch_label || body.batchLabel || '').trim() ||
      new Date().toISOString().slice(0, 10);
    const syncShape = body.sync_shape !== false && body.syncShape !== false;
    const dryRun = body.dry_run === true || body.dryRun === true;

    if (!rawRows.length) {
      return sendJson(res, 400, {
        ok: false,
        error: 'rows must be a non-empty array of spreadsheet objects.',
      });
    }

    const { normalized, skipped } = normalizeMailerRows(rawRows);

    if (!normalized.length) {
      return sendJson(res, 400, {
        ok: false,
        error: 'No valid rows found. Each row needs an Offer Code column.',
        skipped,
      });
    }

    const supabase = getSupabaseClient();
    const result = await importMailerRows(supabase, {
      rows: normalized,
      batchLabel,
      syncShape,
      dryRun,
    });

    return sendJson(res, dryRun ? 200 : 201, {
      ok: true,
      ...result,
      skipped_before_import: skipped,
    });
  } catch (error) {
    const status = error.statusCode || 500;
    return sendJson(res, status, {
      ok: false,
      error: error.message || 'Mailer import failed.',
      auth_hint:
        error.authHint ??
        (status === 401
          ? {
              mailer_secret_configured: Boolean(
                String(process.env.MAILER_IMPORT_SECRET ?? '').trim(),
              ),
            }
          : undefined),
    });
  }
}
