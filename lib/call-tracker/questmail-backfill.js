/**
 * Repair QuestMail lead collisions and re-run AI on calls.
 */

import { getDefaultStatus } from '../status-definitions.js';
import { isTollFreePhone } from '../phone.js';
import { analyzeCallTranscript } from './analyze-call.js';
import { pasteCallTranscript } from './paste-transcript.js';
import { extractOfferCodeCandidates } from '../mailer/offer-code.js';

function outboundEmailSkipped() {
  const v = String(process.env.SKIP_OUTBOUND_EMAIL ?? '').trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes';
}

function parseCallId(externalCallId) {
  const raw = String(externalCallId ?? '');
  for (const suffix of [':answered', ':transcript', ':created']) {
    if (raw.endsWith(suffix)) {
      return raw.slice(0, -suffix.length);
    }
  }
  return raw;
}

function isQuestMailAnswered(row) {
  const meta = row.fields_populated ?? {};
  return meta.call_channel === 'questmail' || meta.questmail_hold || meta.questmail_toll;
}

async function fetchQuestMailAnsweredRows(supabase) {
  const { data, error } = await supabase
    .from('transcripts')
    .select('transcript_id, lead_id, external_call_id, timestamp, fields_populated')
    .like('external_call_id', '%:answered')
    .order('timestamp', { ascending: true });

  if (error) {
    throw error;
  }

  return (data ?? []).filter(isQuestMailAnswered);
}

/**
 * Clear toll-free numbers from QuestMail lead rows (borrower phone comes from transcript).
 */
export async function clearTollFreeLeadPhones(supabase, { dryRun = false } = {}) {
  const { data: leads, error } = await supabase
    .from('leads')
    .select('lead_id, full_name, phone_number, lead_source')
    .eq('lead_source', 'questmail');

  if (error) {
    throw error;
  }

  const touched = [];
  for (const lead of leads ?? []) {
    if (!lead.phone_number || !isTollFreePhone(lead.phone_number)) {
      continue;
    }

    touched.push({
      lead_id: lead.lead_id,
      full_name: lead.full_name,
      cleared_phone: lead.phone_number,
    });

    if (!dryRun) {
      await supabase
        .from('leads')
        .update({ phone_number: null, updated_at: new Date().toISOString() })
        .eq('lead_id', lead.lead_id);
    }
  }

  return { cleared: touched.length, leads: touched, dry_run: dryRun };
}

/**
 * When multiple QuestMail calls share one lead_id, create a dedicated lead per call.
 */
export async function splitSharedQuestMailLeads(supabase, { dryRun = false } = {}) {
  const answeredRows = await fetchQuestMailAnsweredRows(supabase);
  const byLead = new Map();

  for (const row of answeredRows) {
    if (!row.lead_id) {
      continue;
    }
    if (!byLead.has(row.lead_id)) {
      byLead.set(row.lead_id, []);
    }
    byLead.get(row.lead_id).push(row);
  }

  const defaultStatus = await getDefaultStatus(supabase);
  const splits = [];

  for (const [leadId, rows] of byLead) {
    if (rows.length < 2) {
      continue;
    }

    const [, ...extraRows] = rows.sort(
      (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
    );

    for (const row of extraRows) {
      const callId = parseCallId(row.external_call_id);
      splits.push({
        call_id: callId,
        old_lead_id: leadId,
        answered_transcript_id: row.transcript_id,
      });

      if (dryRun) {
        continue;
      }

      const { data: newLead, error: insertError } = await supabase
        .from('leads')
        .insert({
          shape_lead_id: null,
          full_name: 'QuestMail Caller',
          phone_number: null,
          lead_source: 'questmail',
          current_status_label: defaultStatus.status_label,
          current_status_color: defaultStatus.color,
          updated_at: new Date().toISOString(),
        })
        .select('lead_id')
        .single();

      if (insertError) {
        throw insertError;
      }

      const newLeadId = newLead.lead_id;

      for (const suffix of [':answered', ':transcript']) {
        await supabase
          .from('transcripts')
          .update({ lead_id: newLeadId })
          .eq('external_call_id', `${callId}${suffix}`);
      }
    }
  }

  return { split_count: splits.length, splits, dry_run: dryRun };
}

/**
 * Re-run QuestMail AI pipeline for calls that already have transcript text.
 */
export async function reprocessQuestMailCalls(supabase, { callIds = null, limit = 50, dryRun = false } = {}) {
  const answeredRows = await fetchQuestMailAnsweredRows(supabase);
  let targets = [...new Set(answeredRows.map((row) => parseCallId(row.external_call_id)))];

  if (callIds?.length) {
    const wanted = new Set(callIds.map((id) => String(id).trim()));
    targets = targets.filter((id) => wanted.has(id));
  }

  targets = targets.slice(0, limit);

  const preview = [];
  for (const callId of targets) {
    const { data: transcript } = await supabase
      .from('transcripts')
      .select('transcript_text')
      .eq('external_call_id', `${callId}:transcript`)
      .maybeSingle();
    const text = String(transcript?.transcript_text ?? '').trim();
    preview.push({ call_id: callId, transcript_chars: text.length, has_transcript: text.length >= 40 });
  }

  if (dryRun) {
    return { dry_run: true, would_reprocess: preview.filter((r) => r.has_transcript).length, targets: preview };
  }

  const results = [];
  for (const target of preview) {
    if (!target.has_transcript) {
      results.push({ call_id: target.call_id, ok: false, error: 'No transcript text saved' });
      continue;
    }

    try {
      const result = await analyzeCallTranscript(supabase, target.call_id);
      results.push({
        call_id: target.call_id,
        ok: true,
        ai_status_label: result.ai_status_label,
        shape_lead_id: result.shape_lead_id,
      });
    } catch (err) {
      results.push({
        call_id: target.call_id,
        ok: false,
        error: err.message ?? String(err),
      });
    }
  }

  return {
    reprocessed: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok).length,
    results,
  };
}

/**
 * Paste transcript text onto a call and run AI (for missing/wrong Zoom transcripts).
 */
export async function backfillCallTranscript(
  supabase,
  { callId, transcriptText, force = true, runAi = true },
) {
  return pasteCallTranscript(supabase, {
    callId,
    transcriptText,
    runAi,
    force,
  });
}

/**
 * Find QuestMail calls on a date that mention a reference code in transcript or meta.
 */
export async function findCallsByReferenceHint(supabase, referenceCode) {
  const code = String(referenceCode ?? '').trim().toUpperCase();
  if (!code) {
    return [];
  }

  const { data, error } = await supabase
    .from('transcripts')
    .select('external_call_id, transcript_text, lead_id, timestamp, fields_populated')
    .like('external_call_id', '%:transcript')
    .order('timestamp', { ascending: false })
    .limit(500);

  if (error) {
    throw error;
  }

  const hits = [];
  for (const row of data ?? []) {
    const text = String(row.transcript_text ?? '');
    const codes = extractOfferCodeCandidates(text);
    const metaCode = String(row.fields_populated?.reference_code ?? '').toUpperCase();
    if (codes.includes(code) || metaCode === code || text.toUpperCase().includes(code)) {
      hits.push({
        call_id: parseCallId(row.external_call_id),
        lead_id: row.lead_id,
        timestamp: row.timestamp,
      });
    }
  }

  return hits;
}

/**
 * Full QuestMail backfill: repair collisions, optionally reprocess all calls.
 */
export async function runQuestMailBackfill(
  supabase,
  {
    dryRun = false,
    repairPhones = true,
    splitLeads = true,
    reprocess = true,
    reprocessLimit = 100,
    callIds = null,
    transcripts = null,
    skipEmail = false,
  } = {},
) {
  if (skipEmail) {
    process.env.SKIP_OUTBOUND_EMAIL = '1';
  }

  const report = {
    dry_run: dryRun,
    skip_email: Boolean(skipEmail || outboundEmailSkipped()),
    cleared_phones: null,
    split_leads: null,
    pasted_transcripts: [],
    reprocess: null,
  };

  if (repairPhones) {
    report.cleared_phones = await clearTollFreeLeadPhones(supabase, { dryRun });
  }

  if (splitLeads) {
    report.split_leads = await splitSharedQuestMailLeads(supabase, { dryRun });
  }

  if (transcripts?.length && !dryRun) {
    for (const row of transcripts) {
      if (!row.call_id || !row.transcript_text) {
        continue;
      }
      try {
        const pasted = await backfillCallTranscript(supabase, {
          callId: row.call_id,
          transcriptText: row.transcript_text,
          force: row.force !== false,
          runAi: row.run_ai !== false,
        });
        report.pasted_transcripts.push({ call_id: row.call_id, ok: true, ...pasted });
      } catch (err) {
        report.pasted_transcripts.push({
          call_id: row.call_id,
          ok: false,
          error: err.message ?? String(err),
        });
      }
    }
  }

  if (reprocess && !dryRun) {
    report.reprocess = await reprocessQuestMailCalls(supabase, {
      callIds,
      limit: reprocessLimit,
    });
  } else if (reprocess && dryRun) {
    report.reprocess = await reprocessQuestMailCalls(supabase, {
      callIds,
      limit: reprocessLimit,
      dryRun: true,
    });
  }

  return report;
}
