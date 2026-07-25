#!/usr/bin/env node
/**
 * Import QuestMail CSV files into Supabase + Shape (same pipeline as /mailer-import/).
 *
 * Usage:
 *   node scripts/import-mailer-csv.mjs \
 *     --label "June 26, 2026 — QuestMail W626" \
 *     file1.csv file2.csv
 *
 * Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SHAPE_POST_LEAD_URL, SHAPE_API_KEY, etc.
 * Loads inboundnewprocess/.env.local when present.
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { getSupabaseClient } from '../lib/supabase.js';
import { importMailerRows } from '../lib/mailer/import.js';
import { normalizeMailerRows } from '../lib/mailer/normalize.js';
import { syncMailerBatchToShape } from '../lib/mailer/sync-batch-shape.js';
import { assignConciergeOwnersForBatch } from '../lib/mailer/concierge-assign.js';

const CHUNK_SIZE = 10;
const SHAPE_BATCH_LIMIT = 5;

function loadDotEnv() {
  const envPath = resolve(process.cwd(), '.env.local');
  if (!existsSync(envPath)) {
    return;
  }

  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const match = line.match(/^([^#=]+)=(.*)$/);
    if (!match) continue;
    const key = match[1].trim();
    if (process.env[key]) continue;
    process.env[key] = match[2].trim().replace(/^["']|["']$/g, '');
  }
}

function parseArgs(argv) {
  const files = [];
  let batchLabel = '';
  let dryRun = false;
  let skipShape = false;
  let shapeOnlyBatchId = null;

  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--dry-run') {
      dryRun = true;
    } else if (arg === '--no-shape') {
      skipShape = true;
    } else if (arg === '--label' && argv[i + 1]) {
      batchLabel = argv[++i];
    } else if (arg === '--shape-sync-batch' && argv[i + 1]) {
      shapeOnlyBatchId = argv[++i];
    } else if (!arg.startsWith('-')) {
      files.push(resolve(arg));
    }
  }

  return {
    files,
    batchLabel: batchLabel || 'June 26, 2026 — QuestMail W626',
    dryRun,
    skipShape,
    shapeOnlyBatchId,
  };
}

/** Minimal RFC-style CSV parser (handles quoted fields). */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];

    if (inQuotes) {
      if (char === '"' && next === '"') {
        field += '"';
        i += 1;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n' || (char === '\r' && next === '\n')) {
      row.push(field);
      field = '';
      if (row.some((cell) => String(cell).trim() !== '')) {
        rows.push(row);
      }
      row = [];
      if (char === '\r') i += 1;
    } else if (char !== '\r') {
      field += char;
    }
  }

  if (field.length || row.length) {
    row.push(field);
    if (row.some((cell) => String(cell).trim() !== '')) {
      rows.push(row);
    }
  }

  if (!rows.length) {
    return [];
  }

  const headers = rows[0].map((h) => String(h).trim());
  return rows.slice(1).map((cells) => {
    const obj = {};
    for (let i = 0; i < headers.length; i += 1) {
      obj[headers[i]] = cells[i] ?? '';
    }
    return obj;
  });
}

function loadCsvFiles(files) {
  const allRows = [];
  for (const file of files) {
    const text = readFileSync(file, 'utf8');
    const rows = parseCsv(text);
    console.info(`[import-csv] ${file}: ${rows.length} data row(s)`);
    allRows.push(...rows);
  }
  return allRows;
}

async function syncShapeLoop(supabase, batchId) {
  let iteration = 0;
  let totalCreated = 0;
  let totalFailed = 0;

  while (true) {
    iteration += 1;
    const result = await syncMailerBatchToShape(supabase, batchId, {
      limit: SHAPE_BATCH_LIMIT,
      shapeDelayMs: 40,
    });

    totalCreated += result.shape_created || 0;
    totalFailed += result.shape_failed || 0;

    console.info(
      `[import-csv] shape batch ${iteration}: processed=${result.processed} created=${result.shape_created} remaining=${result.remaining_without_shape}`,
    );

    if (result.done || !result.processed) {
      return { totalCreated, totalFailed, remaining: result.remaining_without_shape ?? 0 };
    }
  }
}

async function main() {
  loadDotEnv();

  const { files, batchLabel, dryRun, skipShape, shapeOnlyBatchId } = parseArgs(process.argv);

  if (shapeOnlyBatchId) {
    const supabase = getSupabaseClient();
    const shapeResult = await syncShapeLoop(supabase, shapeOnlyBatchId);
    const concierge = await assignConciergeOwnersForBatch(supabase, shapeOnlyBatchId);
    console.info('[import-csv] shape-only complete', { shapeResult, concierge });
    return;
  }

  if (!files.length) {
    throw new Error(
      'Usage: node scripts/import-mailer-csv.mjs [--label "June 26, 2026 — QuestMail W626"] file1.csv [file2.csv ...]',
    );
  }

  const rawRows = loadCsvFiles(files);
  const { normalized, skipped } = normalizeMailerRows(rawRows);

  console.info('[import-csv] normalized', {
    total: rawRows.length,
    valid: normalized.length,
    skipped: skipped.length,
    batchLabel,
    dryRun,
    skipShape,
  });

  if (!normalized.length) {
    throw new Error('No valid rows (each row needs Offer Code).');
  }

  if (dryRun) {
    console.info('[import-csv] preview', normalized.slice(0, 3).map(({ row }) => row.reference_code));
    return;
  }

  const supabase = getSupabaseClient();
  let batchId = null;
  const aggregated = {
    db_upserted: 0,
    shape_created: 0,
    shape_skipped: 0,
    shape_failed: 0,
    errors: [],
  };

  for (let start = 0; start < normalized.length; start += CHUNK_SIZE) {
    const chunk = normalized.slice(start, start + CHUNK_SIZE);
    const chunkNum = Math.floor(start / CHUNK_SIZE) + 1;
    const totalChunks = Math.ceil(normalized.length / CHUNK_SIZE);

    console.info(`[import-csv] db chunk ${chunkNum}/${totalChunks} (${chunk.length} rows)`);

    const result = await importMailerRows(supabase, {
      rows: chunk,
      batchLabel,
      syncShape: !skipShape && normalized.length < 8,
      dryRun: false,
      existingBatchId: batchId,
      shapeDelayMs: 80,
    });

    if (!batchId) {
      batchId = result.batch_id;
    }

    const s = result.summary || {};
    aggregated.db_upserted += s.db_upserted || 0;
    aggregated.shape_created += s.shape_created || 0;
    aggregated.shape_skipped += s.shape_skipped || 0;
    aggregated.shape_failed += s.shape_failed || 0;
    if (s.errors?.length) aggregated.errors.push(...s.errors);
  }

  if (!skipShape && batchId && normalized.length >= 8) {
    const shapeResult = await syncShapeLoop(supabase, batchId);
    aggregated.shape_created += shapeResult.totalCreated;
    aggregated.shape_failed += shapeResult.totalFailed;

    const concierge = await assignConciergeOwnersForBatch(supabase, batchId);
    console.info('[import-csv] concierge assignment', concierge);
  }

  console.info('[import-csv] done', {
    batch_id: batchId,
    batch_label: batchLabel,
    ...aggregated,
  });
}

main().catch((error) => {
  console.error('[import-csv] failed', error.message || error);
  process.exit(1);
});
