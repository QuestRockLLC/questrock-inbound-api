/**
 * Nikk-style QuestMail Lead Cycle report — overview, pipeline, scorecard.
 * Dedupes multiple calls per borrower and classifies from verified ops status + transcript.
 */

function normalizeStatus(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase();
}

function combinedText(call) {
  return `${call.transcript_text ?? ''}\n${call.call_summary ?? ''}\n${call.ops_status_label ?? ''}`.toLowerCase();
}

export function isSpanishSpeakingLead(call) {
  const status = normalizeStatus(call.ops_status_label || call.crm_status_label);
  const text = combinedText(call);

  if (status.includes('bad lead') && /spanish|español|espanol|language/i.test(text)) {
    return true;
  }

  return (
    /\b(spanish[\s-]?speaking|español|espanol|habla español|no english|doesn'?t speak english|don'?t speak english|language barrier|need a translator|translator|interpret)/i.test(
      text,
    ) ||
    /(no hablo|no english|solo español|only spanish)/i.test(text)
  );
}

function isApplicationTaken(status) {
  const patterns = [
    'app sent',
    'app started',
    'app completed',
    'verification docs',
    'pre-approved',
    'pre-qualified',
    'pitched',
    'package out',
    'piped',
    'funded',
    'application completed',
  ];
  return patterns.some((p) => status.includes(p));
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

function funnelTier(pipeline, status) {
  if (isCloseStage(status)) {
    return 'close';
  }
  if (isPipeStage(status) || pipeline === 'package_out') {
    return 'pipe';
  }
  if (isCreditStage(status) || pipeline === 'verification_pitched') {
    return 'credit';
  }
  if (pipeline === 'verification_waiting' || isApplicationTaken(status)) {
    return 'app';
  }
  return null;
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

function isWaitingToPitchStatus(status) {
  return (
    status.includes('pitch appointment') ||
    status.includes('first call appointment') ||
    status.includes('application completed') ||
    status.includes('pitched & waiting') ||
    status.includes('pitched and waiting') ||
    status.includes('pitched - follow up') ||
    status.includes('pitched - waiting') ||
    status.includes('app sent') ||
    status.includes('app started')
  );
}

function pipelineRank(status) {
  if (status.includes('funded')) return 100;
  if (status.includes('piped')) return 90;
  if (status.includes('package out')) return 85;
  if (status.includes('pre-approved') || status.includes('pre-qualified')) return 80;
  if (status.includes('verification')) return 75;
  if (status.includes('app completed')) return 70;
  if (status.includes('app started') || status.includes('app sent')) return 65;
  if (isPitchedStatus(status)) return 60;
  if (isWaitingToPitchStatus(status)) return 55;
  if (status.includes('long term nurture')) return 20;
  if (status.includes('did not advance')) return 15;
  if (status.includes('not contacted')) return 10;
  if (status.includes('do not call')) return 5;
  if (status.includes('bad lead')) return 3;
  return 30;
}

export function classifyLeadPipeline(call) {
  const status = normalizeStatus(call.ops_status_label);

  if (isSpanishSpeakingLead(call)) {
    return 'bad_leads_spanish';
  }
  if (status.includes('do not call')) {
    return 'do_not_call';
  }
  if (status.includes('package out')) {
    return 'package_out';
  }
  if (isPitchedStatus(status)) {
    return 'verification_pitched';
  }
  if (isWaitingToPitchStatus(status) || isApplicationTaken(status)) {
    return 'verification_waiting';
  }
  if (status.includes('did not advance') || status.includes('not contacted')) {
    return 'did_not_advance';
  }
  if (status.includes('long term nurture')) {
    return 'long_term_nurture';
  }
  if (status.includes('turndown') || status.includes('bad lead')) {
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
  const byKey = new Map();

  for (const call of calls) {
    const key =
      call.shape_lead_id ||
      call.reference_code ||
      call.phone ||
      call.lead_id ||
      call.call_id;

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

  return [...byKey.values()];
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

    pipelineCounts[pipeline] = (pipelineCounts[pipeline] ?? 0) + 1;
    overviewCounts[overview] = (overviewCounts[overview] ?? 0) + 1;

    const tier = funnelTier(pipeline, status);
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

  const overviewSummary = buildOverviewSummary(total, overviewCounts);
  const pipelineSummary = buildPipelineSummary(total, pipelineCounts, verificationTotal);
  const managementTakeaway = buildManagementTakeaway({
    total,
    overviewCounts,
    pipelineCounts,
    apps,
    credit,
    pipes,
    closes,
  });

  return {
    cycle_label: cycleLabel,
    total_leads: total,
    total_calls: calls.length,
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
      summary: overviewSummary,
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
      summary: pipelineSummary,
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
      management_takeaway: managementTakeaway,
    },
    leads: leads.map((lead) => ({
      borrower_name: lead.borrower_name,
      ops_status_label: lead.ops_status_label,
      pipeline: classifyLeadPipeline(lead),
      overview: classifyLeadOverview(lead),
      spanish: isSpanishSpeakingLead(lead),
      reference_code: lead.reference_code,
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
      ? `${verificationTotal} in Verification (${counts.verification_pitched} pitched, ${counts.verification_waiting} waiting to pitch).`
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

function buildManagementTakeaway({ total, overviewCounts, pipelineCounts, apps, credit, pipes, closes }) {
  if (!total) {
    return 'No QuestMail activity to score yet this cycle.';
  }

  const lines = [
    `The team handled ${total} QuestMail lead${total === 1 ? '' : 's'} with ${apps} application${apps === 1 ? '' : 's'} taken (${rate(apps, total)}% calls-to-apps).`,
  ];

  if (overviewCounts.spanish_speaking) {
    lines.push(
      `Spanish-speaking leads remain the largest source of fallout (${overviewCounts.spanish_speaking} of ${total}) — consider bilingual LO coverage or mailer targeting.`,
    );
  }

  if (pipelineCounts.package_out || pipelineCounts.verification_pitched) {
    lines.push(
      `Active files in Package Out / Pitched stages (${pipelineCounts.package_out + pipelineCounts.verification_pitched}) show room to convert credit into pipes and closes.`,
    );
  } else if (apps > 0 && pipes === 0) {
    lines.push('Applications are coming in but nothing has piped yet — focus on credit pull and doc collection.');
  }

  if (closes === 0 && pipes > 0) {
    lines.push(`${pipes} file${pipes === 1 ? '' : 's'} piped with no closes yet this cycle.`);
  }

  return lines.join(' ');
}
