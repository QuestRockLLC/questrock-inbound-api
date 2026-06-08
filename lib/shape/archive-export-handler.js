import { getSupabaseClient } from '../supabase.js';
import { assertImportAuthorized, readJsonBody, sendJson } from '../http.js';
import {
  createArchiveBatch,
  DEFAULT_ARCHIVE_SOURCES,
  getArchiveBatchSummary,
  runBulkExportChunk,
  runEnrichChunk,
} from './archive.js';
import { DEFAULT_BULK_EXPORT_FIELDS } from './bulk-export.js';

function parseSources(body) {
  const raw = body.source_filters ?? body.sourceFilters ?? body.sources;
  if (Array.isArray(raw) && raw.length) {
    return raw.map((value) => String(value).trim()).filter(Boolean);
  }

  const envRaw = process.env.SHAPE_ARCHIVE_SOURCES;
  if (envRaw?.trim()) {
    try {
      const parsed = JSON.parse(envRaw);
      if (Array.isArray(parsed) && parsed.length) {
        return parsed.map((value) => String(value).trim()).filter(Boolean);
      }
    } catch {
      return envRaw
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean);
    }
  }

  return DEFAULT_ARCHIVE_SOURCES;
}

export function isShapeArchiveRequest(req, body = null) {
  const resource = String(
    req.query?.resource ?? body?.resource ?? req.query?.mode ?? body?.mode ?? '',
  ).trim();

  if (resource === 'shape-archive' || resource === 'archive') {
    return true;
  }

  const archiveActions = new Set([
    'bulk',
    'continue_bulk',
    'enrich',
    'continue_enrich',
    'run_all',
  ]);

  const action = String(body?.action ?? req.query?.action ?? '').trim().toLowerCase();
  if (archiveActions.has(action)) {
    return true;
  }

  if (req.method === 'GET' && (req.query?.batch_id ?? req.query?.batchId)) {
    const table = String(req.query?.table ?? '').trim();
    if (table === 'shape_archive' || table === 'archive') {
      return true;
    }
  }

  return false;
}

export async function handleShapeArchiveExport(req, res) {
  if (req.method === 'GET') {
    try {
      assertImportAuthorized(req, {
        import_secret: req.query?.import_secret ?? req.query?.importSecret,
      });

      const supabase = getSupabaseClient();
      const batchId = req.query?.batch_id ?? req.query?.batchId;

      if (batchId) {
        const summary = await getArchiveBatchSummary(supabase, batchId);
        if (!summary) {
          return sendJson(res, 404, { ok: false, error: 'Batch not found.' });
        }

        return sendJson(res, 200, { ok: true, batch: summary });
      }

      const limit = Math.min(Number(req.query?.limit) || 10, 50);
      const { data: batches, error } = await supabase
        .from('shape_archive_batches')
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
        error: error.message || 'Failed to load archive batches.',
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

    const supabase = getSupabaseClient();
    const action = String(body.action ?? 'start').trim().toLowerCase();
    const batchId = body.batch_id ?? body.batchId ?? null;

    if (action === 'bulk' || action === 'continue_bulk') {
      if (!batchId) {
        return sendJson(res, 400, { ok: false, error: 'batch_id required for bulk export chunk.' });
      }

      const result = await runBulkExportChunk(supabase, batchId, {
        maxPages: Math.min(Number(body.max_pages ?? body.maxPages) || 5, 20),
        pageDelayMs: Number(body.page_delay_ms ?? body.pageDelayMs) || 400,
      });

      const batch = await getArchiveBatchSummary(supabase, batchId);
      return sendJson(res, 200, { ok: true, ...result, batch });
    }

    if (action === 'enrich' || action === 'continue_enrich') {
      if (!batchId) {
        return sendJson(res, 400, { ok: false, error: 'batch_id required for enrich chunk.' });
      }

      const result = await runEnrichChunk(supabase, batchId, {
        maxLeads: Math.min(Number(body.max_leads ?? body.maxLeads) || 15, 40),
        leadDelayMs: Number(body.lead_delay_ms ?? body.leadDelayMs) || 120,
      });

      const batch = await getArchiveBatchSummary(supabase, batchId);
      return sendJson(res, 200, { ok: true, ...result, batch });
    }

    if (action === 'run_all') {
      if (!batchId) {
        return sendJson(res, 400, { ok: false, error: 'batch_id required for run_all.' });
      }

      const bulkResult = await runBulkExportChunk(supabase, batchId, {
        maxPages: Math.min(Number(body.max_pages ?? body.maxPages) || 5, 20),
        pageDelayMs: Number(body.page_delay_ms ?? body.pageDelayMs) || 400,
      });

      let enrichResult = null;
      if (!bulkResult.has_more) {
        enrichResult = await runEnrichChunk(supabase, batchId, {
          maxLeads: Math.min(Number(body.max_leads ?? body.maxLeads) || 15, 40),
          leadDelayMs: Number(body.lead_delay_ms ?? body.leadDelayMs) || 120,
        });
      }

      const batch = await getArchiveBatchSummary(supabase, batchId);
      return sendJson(res, 200, {
        ok: true,
        bulk: bulkResult,
        enrich: enrichResult,
        batch,
      });
    }

    const dateFrom = String(body.date_from ?? body.dateFrom ?? '2025-12-01').trim();
    const dateTo = String(body.date_to ?? body.dateTo ?? '2026-06-08').trim();
    const batchLabel = String(body.batch_label ?? body.batchLabel ?? '').trim();
    const sourceFilters = parseSources(body);
    const fields =
      Array.isArray(body.fields) && body.fields.length ? body.fields : DEFAULT_BULK_EXPORT_FIELDS;

    const batch = await createArchiveBatch(supabase, {
      batchLabel,
      dateFrom,
      dateTo,
      sourceFilters,
      fields,
    });

    const autoStart = body.auto_start !== false && body.autoStart !== false;
    let bulkResult = null;

    if (autoStart) {
      bulkResult = await runBulkExportChunk(supabase, batch.batch_id, {
        maxPages: Math.min(Number(body.max_pages ?? body.maxPages) || 5, 20),
        pageDelayMs: Number(body.page_delay_ms ?? body.pageDelayMs) || 400,
      });
    }

    const summary = await getArchiveBatchSummary(supabase, batch.batch_id);

    return sendJson(res, 201, {
      ok: true,
      batch: summary,
      bulk: bulkResult,
      message: autoStart
        ? 'Archive batch created and first bulk export chunk started. Keep clicking Continue until bulk + enrich complete.'
        : 'Archive batch created. POST action=bulk with batch_id to start export.',
    });
  } catch (error) {
    return sendJson(res, error.statusCode || 500, {
      ok: false,
      error: error.message || 'Shape archive export failed.',
      shape_response: error.shapeResponse,
      auth_hint: error.authHint,
    });
  }
}
