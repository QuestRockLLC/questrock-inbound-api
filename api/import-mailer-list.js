import { getSupabaseClient } from '../lib/supabase.js';
import { importMailerRows, syncMailerRowsToShape } from '../lib/mailer/import.js';
import { assignConciergeOwnersForBatch } from '../lib/mailer/concierge-assign.js';
import { syncMailerBatchToShape, countMailerLeadsWithoutShape } from '../lib/mailer/sync-batch-shape.js';
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
      const batchId = String(req.query?.batch_id ?? req.query?.batchId ?? '').trim();

      if (batchId) {
        const { data: batch, error: batchError } = await supabase
          .from('mailer_import_batches')
          .select('*')
          .eq('batch_id', batchId)
          .maybeSingle();

        if (batchError) {
          throw batchError;
        }

        const { count: totalInBatch, error: totalError } = await supabase
          .from('mailer_leads')
          .select('mailer_lead_id', { count: 'exact', head: true })
          .eq('import_batch_id', batchId);

        if (totalError) {
          throw totalError;
        }

        const pendingWithoutShape = batch
          ? await countMailerLeadsWithoutShape(supabase, batchId)
          : 0;

        return sendJson(res, 200, {
          ok: true,
          batch,
          batch_id: batchId,
          total_in_batch: totalInBatch ?? 0,
          pending_without_shape: pendingWithoutShape,
          batch_found: Boolean(batch),
        });
      }

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
    const conciergeAssignOnly =
      body.concierge_assign === true || body.conciergeAssign === true;
    const shapeSyncBatch = body.shape_sync_batch === true || body.shapeSyncBatch === true;

    const supabase = getSupabaseClient();

    if (shapeSyncBatch && existingBatchId) {
      const limit = Math.min(Number(body.limit) || 3, 5);
      const summary = await syncMailerBatchToShape(supabase, existingBatchId, { limit });
      return sendJson(res, 200, {
        ok: true,
        batch_id: existingBatchId,
        shape_sync_batch: summary,
      });
    }

    if (conciergeAssignOnly && existingBatchId) {
      const summary = await assignConciergeOwnersForBatch(supabase, existingBatchId);
      return sendJson(res, 200, {
        ok: true,
        batch_id: existingBatchId,
        concierge_assignment: summary,
      });
    }

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

    if (shapeSyncOnly) {
      if (!existingBatchId) {
        return sendJson(res, 400, { ok: false, error: 'batch_id required for shape_sync_only.' });
      }

      if (normalized.length >= ASYNC_SHAPE_ROW_THRESHOLD) {
        const limit = Math.min(Number(body.limit) || 20, 30);
        const summary = await syncMailerBatchToShape(supabase, existingBatchId, { limit });
        return sendJson(res, 200, {
          ok: true,
          batch_id: existingBatchId,
          shape_sync_only: true,
          shape_sync_batch: summary,
          message:
            'Bulk shape_sync_only uses chunked batch sync. Repeat until remaining_without_shape is 0.',
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

    const result = await importMailerRows(supabase, {
      rows: normalized,
      batchLabel,
      syncShape:
        syncShape &&
        !deferShape &&
        normalized.length < ASYNC_SHAPE_ROW_THRESHOLD,
      dryRun,
      existingBatchId,
    });

    const shapeSyncDeferred =
      syncShape &&
      !dryRun &&
      !deferShape &&
      normalized.length >= ASYNC_SHAPE_ROW_THRESHOLD;

    return sendJson(res, dryRun ? 200 : 201, {
      ok: true,
      ...result,
      shape_sync_deferred: shapeSyncDeferred,
      message: shapeSyncDeferred
        ? 'Rows saved to Supabase. Shape sync must run via chunked batch sync (UI does this automatically).'
        : undefined,
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
