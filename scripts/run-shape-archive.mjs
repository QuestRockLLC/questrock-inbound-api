#!/usr/bin/env node
/**
 * Run full Shape archive locally (bulk export + notes enrich → Supabase).
 *
 * Usage:
 *   SHAPE_API_KEY=... SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
 *     node scripts/run-shape-archive.mjs
 *
 * Optional:
 *   DATE_FROM=2025-12-01 DATE_TO=2026-06-08
 *   MAX_PAGES_PER_CHUNK=20 MAX_LEADS_PER_ENRICH=30
 */
import { getSupabaseClient } from '../lib/supabase.js';
import {
  createArchiveBatch,
  getArchiveBatchSummary,
  runBulkExportChunk,
  runEnrichChunk,
} from '../lib/shape/archive.js';

const dateFrom = process.env.DATE_FROM || '2025-12-01';
const dateTo = process.env.DATE_TO || '2026-06-08';
const maxPages = Number(process.env.MAX_PAGES_PER_CHUNK || 20);
const maxLeads = Number(process.env.MAX_LEADS_PER_ENRICH || 30);

async function main() {
  if (!process.env.SHAPE_API_KEY && !process.env.SHAPE_ACCESS_TOKEN) {
    throw new Error('Missing SHAPE_API_KEY');
  }

  const supabase = getSupabaseClient();

  console.info('[shape-archive] Creating batch', dateFrom, '→', dateTo);
  const batch = await createArchiveBatch(supabase, {
    batchLabel: `CLI archive ${dateFrom} → ${dateTo}`,
    dateFrom,
    dateTo,
  });

  console.info('[shape-archive] Batch', batch.batch_id);

  let bulkHasMore = true;
  while (bulkHasMore) {
    const bulk = await runBulkExportChunk(supabase, batch.batch_id, {
      maxPages,
      pageDelayMs: 350,
    });
    console.info(
      '[shape-archive] bulk page chunk:',
      bulk.pages_processed,
      'matched',
      bulk.bulk_leads_matched,
      'seen',
      bulk.bulk_leads_seen,
    );
    bulkHasMore = bulk.has_more;
  }

  let enrichHasMore = true;
  while (enrichHasMore) {
    const enrich = await runEnrichChunk(supabase, batch.batch_id, {
      maxLeads,
      leadDelayMs: 120,
    });
    console.info(
      '[shape-archive] enrich chunk:',
      enrich.enriched,
      'notes',
      enrich.notes_added,
      'pending',
      enrich.has_more,
    );
    enrichHasMore = enrich.has_more;
  }

  const summary = await getArchiveBatchSummary(supabase, batch.batch_id);
  console.info('[shape-archive] DONE', JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error('[shape-archive] FAILED', error.message);
  if (error.shapeResponse) {
    console.error(JSON.stringify(error.shapeResponse, null, 2));
  }
  process.exit(1);
});
