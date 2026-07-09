/**
 * Repair QuestMail lead collisions and re-run AI on all calls.
 *
 * Usage:
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... OPENAI_API_KEY=... \
 *     node scripts/backfill-questmail.mjs [--dry-run] [--no-reprocess] [--no-email]
 *
 * --no-email  Sets SKIP_OUTBOUND_EMAIL=1 so Zapier/Resend are not hit (no LO or admin emails).
 */
import { createClient } from '@supabase/supabase-js';
import { runQuestMailBackfill } from '../lib/call-tracker/questmail-backfill.js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const args = new Set(process.argv.slice(2));
const dryRun = args.has('--dry-run');
const reprocess = !args.has('--no-reprocess');
const noEmail = args.has('--no-email');

if (noEmail) {
  process.env.SKIP_OUTBOUND_EMAIL = '1';
  console.error('[backfill] SKIP_OUTBOUND_EMAIL=1 — no Zapier/Resend emails will be sent.');
}

const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const report = await runQuestMailBackfill(supabase, {
  dryRun,
  repairPhones: true,
  splitLeads: true,
  reprocess,
  reprocessLimit: 200,
});

console.log(JSON.stringify(report, null, 2));
