import { waitUntil } from '@vercel/functions';
import { getSupabaseClient } from '../lib/supabase.js';
import { importMailerRows, syncMailerRowsToShape } from '../lib/mailer/import.js';
import { normalizeMailerRows } from '../lib/mailer/normalize.js';
import { assertInboundSession } from '../lib/request-auth.js';
import { readJsonBody, sendJson } from '../lib/http.js';
import {
  handleShapeArchiveExport,
  isShapeArchiveRequest,
} from '../lib/shape/archive-export-handler.js';

const ASYNC_SHAPE_ROW_THRESHOLD = 8;

export default async function handler(req, res) {
  const body = req.method === 'POST' ? readJsonBody(req) : null;

  if (isShapeArchiveRequest(req, body)) {
    return handleShapeArchiveExport(req, res);
  }

  if (req.method === 'GET') {
    try {
      assertInboundSession(req, { requireAdmin: true });
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
    assertInboundSession(req, { requireAdmin: true });
    const rawRows = Array.isArray(body.rows) ? body.rows : [];
    const batchLabel = String(body.batch_label || body.batchLabel || '').trim() ||
      new Date().toISOString().slice(0, 10);
    const syncShape = body.sync_shape !== false && body.syncShape !== false;
    const dryRun = body.dry_run === true || body.dryRun === true;
    const existingBatchId = body.batch_id ?? body.batchId ?? null;
    const deferShape = body.defer_shape === true || body.deferShape === true;
    const shapeSyncOnly = body.shape_sync_only === true || body.shapeSyncOnly === true;

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

    if (shapeSyncOnly) {
      if (!existingBatchId) {
        return sendJson(res, 400, { ok: false, error: 'batch_id required for shape_sync_only.' });
      }

      if (normalized.length >= ASYNC_SHAPE_ROW_THRESHOLD) {
        waitUntil(
          syncMailerRowsToShape(supabase, normalized)
            .then((shapeSummary) => {
              console.info('[import-mailer-list] background Shape-only sync complete', shapeSummary);
            })
            .catch((error) => {
              console.error('[import-mailer-list] background Shape-only sync failed:', error);
            }),
        );

        return sendJson(res, 202, {
          ok: true,
          batch_id: existingBatchId,
          shape_sync_only: true,
          async_shape_sync: true,
          message: 'Shape sync started in background for all rows.',
        });
      }

      const shapeSummary = await syncMailerRowsToShape(supabase, normalized);

      return sendJson(res, 200, {
        ok: true,
        batch_id: existingBatchId,
        shape_sync_only: true,
        summary: shapeSummary,
      });
    }

    const useAsyncShape =
      syncShape && !dryRun && !deferShape && normalized.length >= ASYNC_SHAPE_ROW_THRESHOLD;

    const result = await importMailerRows(supabase, {
      rows: normalized,
      batchLabel,
      syncShape: syncShape && !useAsyncShape && !deferShape,
      dryRun,
      existingBatchId,
    });

    if (useAsyncShape) {
      const batchId = result.batch_id;
      waitUntil(
        (async () => {
          const shapeSummary = await syncMailerRowsToShape(supabase, normalized);
          const { data: priorBatch } = await supabase
            .from('mailer_import_batches')
            .select('shape_synced_count, error_count')
            .eq('batch_id', batchId)
            .single();

          await supabase
            .from('mailer_import_batches')
            .update({
              shape_synced_count:
                (priorBatch?.shape_synced_count ?? 0) + shapeSummary.shape_created,
              error_count: (priorBatch?.error_count ?? 0) + shapeSummary.errors.length,
            })
            .eq('batch_id', batchId);

          console.info('[import-mailer-list] background Shape sync complete', shapeSummary);
        })().catch((error) => {
          console.error('[import-mailer-list] background Shape sync failed:', error);
        }),
      );

      return sendJson(res, 202, {
        ok: true,
        async_shape_sync: true,
        message:
          'All rows saved to Supabase. Shape CRM sync is running in the background (check batch in ~2–5 min).',
        ...result,
        skipped_before_import: skipped,
      });
    }

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
    });
  }
}
