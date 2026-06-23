/**
 * Scan Jun 16–23 transcripts for QuestMail toll-free lines vs tracked calls.
 * Usage: SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/audit-questmail-tolls.mjs
 */
import { createClient } from '@supabase/supabase-js';
import { resolveQuestMailCycle } from '../lib/call-tracker/questmail-cycle.js';
import { auditQuestMailTollLines } from '../lib/call-tracker/questmail-toll-audit.js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const cycle = resolveQuestMailCycle({});
const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const audit = await auditQuestMailTollLines(supabase, cycle);
console.log(JSON.stringify(audit, null, 2));
