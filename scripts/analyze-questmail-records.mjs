/**
 * Read-only QuestMail analytics across leads, transcripts, and mailer rows.
 * Usage: SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/analyze-questmail-records.mjs
 */
import { createClient } from '@supabase/supabase-js';
import { analyzeQuestMailRecords } from '../lib/call-tracker/questmail-analytics.js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const report = await analyzeQuestMailRecords(supabase);
console.log(JSON.stringify(report, null, 2));
