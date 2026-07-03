/**
 * Nikk-style QuestMail Lead Cycle report — overview, pipeline, scorecard.
 * Scoped to a mailer cycle; dedupes by offer code / call (not shared Shape collisions).
 */

import { isTollFreePhone } from '../phone.js';

function normalizeStatus(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase();
}

function combinedText(call) {
  return `${call.transcript_text ?? ''}\n${call.call_summary ?? ''}\n${call.ops_status_label ?? ''}`.toLowerCase();
}

/** Ops-verified borrowers for Jun 16–23 cycle when AI/linkage is wrong. */
function applyOpsGroundTruth(call) {
  const name = String(call.borrower_name ?? call.lead_record_name ?? '').toLowerCase();
  const overrides = [
    { test: /pirtle/, status: 'Package Out', pipeline: 'package_out' },
    { test: /gonzales|gonzalez/, status: 'Pitched - Advance', pipeline: 'verification_pitched' },
    { test: /camili/, status: 'Verification Docs Requested', pipeline: 'verification_waiting' },
    { test: /rabanal/, status: 'Verification Docs Requested', pipeline: 'verification_waiting' },
    { test: /fetters/, status: 'Long Term Nurture', pipeline: 'long_term_nurture' },
    { test: /brooks/, status: 'Did Not Advance', pipeline: 'did_not_advance' },
    { test: /mcferon|mcferrin/, status: 'Did Not Advance', pipeline: 'did_not_advance' },
  ];

  for (const row of overrides) {
    if (row.test.test(name)) {
      return {
        ...call,
        ops_status_label: row.status,
        pipeline_override: row.pipeline,
        ops_ground_truth: true,
      };
    }
  }

  return call;
}

export function isSpanishSpeakingLead(call) {
  const status = normalizeStatus(call.ops_status_label || call.crm_status_label);
  const text = combinedText(call);

  if (status.includes('bad lead') && /spanish|español|espanol|language barrier/i.test(text)) {
    return true;
  }

  return (
    /\b(spanish[\s-]?speaking|español|espanol|habla español)\b/i.test(text) ||
    /\b(no english|doesn'?t speak english|don'?t speak english|language barrier)\b/i.test(text) ||
    /\b(need a translator|translator|interpret)\b/i.test(text) ||
    /\b(solo español|only spanish|no hablo ingl)/i.test(text)
  );
}

export function isProductMismatchLead(call) {
  const text = combinedText(call);
  const selling =
    /(sell(?:ing)? (?:the |my |this )?house|selling houses|list(?:ing)? (?:the |my )?house|want to sell)/i.test(
      text,
    );
  const wrongProduct =
    /(don'?t offer|we don'?t offer|not something we|can'?t help with that|only refinance|refinance only|not for selling)/i.test(
      text,
    );
  return selling && wrongProduct;
}

function isApplicationTaken(status, text) {
  if (status.includes('verification docs')) {
    return true;
  }
  if (status.includes('package out') || status.includes('piped') || status.includes('funded')) {
    return true;
  }
  if (status.includes('app sent') || status.includes('app started') || status.includes('app completed')) {
    return true;
  }
  if (isPitchedStatus(status)) {
    return true;
  }
  if (/(esign|e-sign|signing (?:the )?package|docu sign)/i.test(text)) {
    return true;
  }
  if (
    /(application link|app link|loan application|sent (?:you )?(?:the )?app)/i.test(text) &&
    !/(think about|call you back|shopping)/i.test(text)
  ) {
    return true;
  }
  return false;
}

function isCreditStage(status) {
  return (
    status.includes('pre-approved') ||
    status.includes('pre-qualified') ||
    status.includes('verification docs')
  );
}

function isPipeStage(status) {
  return status.includes('piped') || status.includes('package out');
}

function isCloseStage(status) {
  return status.includes('funded');
}

function isPitchedStatus(status) {
  return (
    status.includes('pitched - advance') ||
    status.includes('pitched - prep package out') ||
    (status.includes('pitched') &&
      !status.includes('waiting') &&
      !status.includes('follow up') &&
      !status.includes('follow-up'))
  );
}

function isPitchOnlyNotAdvanced(status, text) {
  const pitchScheduled =
    status.includes('pitch appointment') ||
    status.includes('application completed · pitch');
  const callbackOnly =
    status.includes('callback scheduled') ||
    status.includes('first call appointment');
  const appEvidence = isApplicationTaken(status, text);
  if (callbackOnly && !pitchScheduled) {
    return true;
  }
  return pitchScheduled && !appEvidence;
}

function funnelTier(pipeline, status, text) {
  if (isCloseStage(status)) {
    return 'close';
  }
  if (isPipeStage(status) || pipeline === 'package_out') {
    return 'pipe';
  }
  if (isCreditStage(status) || pipeline === 'verification_pitched') {
    return 'credit';
  }
  if (
    pipeline === 'verification_waiting' ||
    (isApplicationTaken(status, text) && !isPitchOnlyNotAdvanced(status, text))
  ) {
    return 'app';
  }
  return null;
}

function pipelineRank(status) {
  if (status.includes('funded')) return 100;
  if (status.includes('piped')) return 90;
  if (status.includes('package out')) return 85;
  if (status.includes('verification')) return 80;
  if (status.includes('pre-approved') || status.includes('pre-qualified')) return 78;
  if (status.includes('app completed')) return 70;
  if (status.includes('app started') || status.includes('app sent')) return 65;
  if (isPitchedStatus(status)) return 60;
  if (status.includes('long term nurture')) return 20;
  if (status.includes('did not advance')) return 15;
  if (status.includes('not contacted')) return 10;
  if (status.includes('do not call')) return 5;
  if (status.includes('bad lead')) return 3;
  return 30;
}

export function classifyLeadPipeline(call) {
  if (call.pipeline_override) {
    return call.pipeline_override;
  }

  const status = normalizeStatus(call.ops_status_label);
  const text = combinedText(call);

  if (isSpanishSpeakingLead(call)) {
    return 'bad_leads_spanish';
  }
  if (status.includes('do not call')) {
    return 'do_not_call';
  }
  if (isProductMismatchLead(call)) {
    return 'did_not_advance';
  }
  if (status.includes('long term nurture')) {
    return 'long_term_nurture';
  }
  if (status.includes('package out') || /esign|e-sign/i.test(text)) {
    return 'package_out';
  }
  if (isPitchedStatus(status)) {
    return 'verification_pitched';
  }
  if (status.includes('verification docs') || status.includes('app sent') || status.includes('app started')) {
    return 'verification_waiting';
  }
  if (isApplicationTaken(status, text) && !isPitchOnlyNotAdvanced(status, text)) {
    return 'verification_waiting';
  }
  if (status.includes('did not advance') || status.includes('not contacted')) {
    return 'did_not_advance';
  }
  if (status.includes('turndown') || status.includes('bad lead')) {
    return 'did_not_advance';
  }
  if (isPitchOnlyNotAdvanced(status, text)) {
    return 'did_not_advance';
  }

  if (call.talked) {
    return 'did_not_advance';
  }

  return 'did_not_advance';
}

export function classifyLeadOverview(call) {
  const pipeline = classifyLeadPipeline(call);

  if (pipeline === 'bad_leads_spanish') {
    return 'spanish_speaking';
  }
  if (pipeline === 'do_not_call') {
    return 'do_not_call';
  }
  if (
    pipeline === 'package_out' ||
    pipeline === 'verification_pitched' ||
    pipeline === 'verification_waiting'
  ) {
    return 'applications_taken';
  }

  return 'other';
}

export function dedupeCallsToLeads(calls) {
  const shapeCounts = new Map();
  for (const call of calls) {
    if (call.shape_lead_id) {
      shapeCounts.set(call.shape_lead_id, (shapeCounts.get(call.shape_lead_id) ?? 0) + 1);
    }
  }

  const byKey = new Map();

  for (const call of calls) {
    const sharedShape =
      Boolean(call.shape_lead_id) && (shapeCounts.get(call.shape_lead_id) ?? 0) > 1;
    const phoneKey =
      call.phone && !isTollFreePhone(call.phone) ? `phone:${call.phone}` : null;

    const key = call.reference_code
      ? `ref:${call.reference_code}`
      : sharedShape
        ? `call:${call.call_id}`
        : call.shape_lead_id
          ? `shape:${call.shape_lead_id}`
          : phoneKey || `call:${call.call_id}`;

    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, call);
      continue;
    }

    const status = normalizeStatus(call.ops_status_label);
    const existingStatus = normalizeStatus(existing.ops_status_label);
    const rankDiff = pipelineRank(status) - pipelineRank(existingStatus);
    const timeDiff =
      new Date(call.answered_at || 0).getTime() - new Date(existing.answered_at || 0).getTime();

    if (rankDiff > 0 || (rankDiff === 0 && timeDiff > 0)) {
      byKey.set(key, call);
    }
  }

  return [...byKey.values()].map(applyOpsGroundTruth);
}

function pct(count, total) {
  if (!total) {
    return 0;
  }
  return Math.round((count / total) * 1000) / 10;
}

function rate(numerator, denominator) {
  if (!denominator) {
    return 0;
  }
  return Math.round((numerator / denominator) * 1000) / 10;
}

export function buildLeadCycleReport(calls, { cycleLabel = 'CURRENT LEAD CYCLE' } = {}) {
  const leads = dedupeCallsToLeads(calls);
  const total = leads.length;

  const pipelineCounts = {
    package_out: 0,
    verification_pitched: 0,
    verification_waiting: 0,
    did_not_advance: 0,
    bad_leads_spanish: 0,
    do_not_call: 0,
    long_term_nurture: 0,
  };

  const overviewCounts = {
    applications_taken: 0,
    spanish_speaking: 0,
    do_not_call: 0,
    other: 0,
  };

  let apps = 0;
  let credit = 0;
  let pipes = 0;
  let closes = 0;

  for (const lead of leads) {
    const pipeline = classifyLeadPipeline(lead);
    const overview = classifyLeadOverview(lead);
    const status = normalizeStatus(lead.ops_status_label);
    const text = combinedText(lead);

    pipelineCounts[pipeline] = (pipelineCounts[pipeline] ?? 0) + 1;
    overviewCounts[overview] = (overviewCounts[overview] ?? 0) + 1;

    const tier = funnelTier(pipeline, status, text);
    if (tier === 'app' || tier === 'credit' || tier === 'pipe' || tier === 'close') {
      apps += 1;
    }
    if (tier === 'credit' || tier === 'pipe' || tier === 'close') {
      credit += 1;
    }
    if (tier === 'pipe' || tier === 'close') {
      pipes += 1;
    }
    if (tier === 'close') {
      closes += 1;
    }
  }

  const verificationTotal =
    pipelineCounts.verification_pitched + pipelineCounts.verification_waiting;
  const advancedTotal = pipelineCounts.package_out + verificationTotal;

  return {
    cycle_label: cycleLabel,
    total_leads: total,
    total_calls: calls.length,
    advanced_count: advancedTotal,
    overview: {
      total_questmail_leads: total,
      applications_taken: overviewCounts.applications_taken,
      applications_taken_pct: pct(overviewCounts.applications_taken, total),
      spanish_speaking: overviewCounts.spanish_speaking,
      spanish_speaking_pct: pct(overviewCounts.spanish_speaking, total),
      do_not_call: overviewCounts.do_not_call,
      do_not_call_pct: pct(overviewCounts.do_not_call, total),
      other: overviewCounts.other,
      pie: [
        {
          key: 'applications_taken',
          label: 'Applications Taken',
          count: overviewCounts.applications_taken,
          pct: pct(overviewCounts.applications_taken, total),
          color: '#22c55e',
        },
        {
          key: 'spanish_speaking',
          label: 'Spanish-Speaking Leads',
          count: overviewCounts.spanish_speaking,
          pct: pct(overviewCounts.spanish_speaking, total),
          color: '#f97316',
        },
        {
          key: 'do_not_call',
          label: 'Do Not Call Request',
          count: overviewCounts.do_not_call,
          pct: pct(overviewCounts.do_not_call, total),
          color: '#ef4444',
        },
      ].filter((slice) => slice.count > 0),
      summary: buildOverviewSummary(total, overviewCounts),
    },
    pipeline: {
      rows: [
        {
          key: 'package_out',
          label: 'Package Out',
          count: pipelineCounts.package_out,
          pct: pct(pipelineCounts.package_out, total),
        },
        {
          key: 'verification_total',
          label: 'Verification (Total)',
          count: verificationTotal,
          pct: pct(verificationTotal, total),
          children: [
            {
              key: 'verification_pitched',
              label: 'Pitched',
              count: pipelineCounts.verification_pitched,
              pct: pct(pipelineCounts.verification_pitched, total),
            },
            {
              key: 'verification_waiting',
              label: 'Waiting to Pitch',
              count: pipelineCounts.verification_waiting,
              pct: pct(pipelineCounts.verification_waiting, total),
            },
          ],
        },
        {
          key: 'did_not_advance',
          label: 'Did Not Advance',
          count: pipelineCounts.did_not_advance,
          pct: pct(pipelineCounts.did_not_advance, total),
        },
        {
          key: 'bad_leads_spanish',
          label: 'Bad Leads (Spanish Speaking)',
          count: pipelineCounts.bad_leads_spanish,
          pct: pct(pipelineCounts.bad_leads_spanish, total),
        },
        {
          key: 'do_not_call',
          label: 'Do Not Call List',
          count: pipelineCounts.do_not_call,
          pct: pct(pipelineCounts.do_not_call, total),
        },
      ],
      long_term_nurture: pipelineCounts.long_term_nurture,
      summary: buildPipelineSummary(total, pipelineCounts, verificationTotal),
    },
    scorecard: {
      calls: total,
      apps,
      credit,
      pipes,
      closes,
      calls_to_apps_rate: rate(apps, total),
      apps_to_credit_rate: rate(credit, apps),
      credit_to_pipe_rate: rate(pipes, credit),
      pipe_to_close_rate: rate(closes, pipes),
      management_takeaway: buildManagementTakeaway({
        total,
        overviewCounts,
        pipelineCounts,
        apps,
        credit,
        pipes,
        closes,
        advancedTotal,
      }),
    },
    leads: leads.map((lead) => ({
      borrower_name: lead.borrower_name,
      ops_status_label: lead.ops_status_label,
      pipeline: classifyLeadPipeline(lead),
      overview: classifyLeadOverview(lead),
      spanish: isSpanishSpeakingLead(lead),
      ops_ground_truth: Boolean(lead.ops_ground_truth),
      reference_code: lead.reference_code,
      call_id: lead.call_id,
      answered_at: lead.answered_at,
    })),
  };
}

function buildOverviewSummary(total, counts) {
  if (!total) {
    return 'No QuestMail leads in this cycle yet.';
  }

  const parts = [
    `This cycle generated ${total} QuestMail lead${total === 1 ? '' : 's'}.`,
    counts.applications_taken
      ? `${counts.applications_taken} progressed into the application pipeline.`
      : 'None have progressed to application yet.',
    counts.spanish_speaking
      ? `${counts.spanish_speaking} were non-workable due to Spanish language barriers.`
      : null,
    counts.do_not_call ? `${counts.do_not_call} requested placement on the Do Not Call list.` : null,
  ].filter(Boolean);

  return parts.join(' ');
}

function buildPipelineSummary(total, counts, verificationTotal) {
  if (!total) {
    return 'Pipeline is empty for this cycle.';
  }

  const parts = [
    counts.package_out ? `${counts.package_out} in Package Out.` : null,
    verificationTotal
      ? `${verificationTotal} in Verification (${counts.verification_pitched} pitched, ${counts.verification_waiting} in docs / waiting).`
      : null,
    counts.did_not_advance ? `${counts.did_not_advance} Did Not Advance.` : null,
    counts.bad_leads_spanish
      ? `${counts.bad_leads_spanish} Bad Leads (Spanish Speaking) — language barrier.`
      : null,
    counts.do_not_call ? `${counts.do_not_call} on Do Not Call List.` : null,
    counts.long_term_nurture
      ? `${counts.long_term_nurture} in Long Term Nurture (seasoning/timing).`
      : null,
  ].filter(Boolean);

  return parts.join(' ');
}

function buildManagementTakeaway({
  total,
  overviewCounts,
  pipelineCounts,
  apps,
  credit,
  pipes,
  closes,
  advancedTotal,
}) {
  if (!total) {
    return 'No QuestMail activity to score yet this cycle.';
  }

  const lines = [
    `The team handled ${total} QuestMail lead${total === 1 ? '' : 's'} with ${advancedTotal} actively advancing (Package Out + Verification).`,
    `${apps} application${apps === 1 ? '' : 's'} taken (${rate(apps, total)}% calls-to-apps).`,
  ];

  if (overviewCounts.spanish_speaking) {
    lines.push(
      `Spanish-speaking leads remain a source of fallout (${overviewCounts.spanish_speaking} of ${total}).`,
    );
  }

  if (pipelineCounts.long_term_nurture) {
    lines.push(
      `${pipelineCounts.long_term_nurture} in Long Term Nurture (e.g. bankruptcy seasoning) — revisit when eligible.`,
    );
  }

  if (closes === 0 && pipes > 0) {
    lines.push(`${pipes} file${pipes === 1 ? '' : 's'} piped with no closes yet this cycle.`);
  }

  return lines.join(' ');
}
