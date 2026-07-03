function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/"/g, '&quot;');
}

function pipelineRowsHtml(pipeline) {
  return (pipeline?.rows ?? [])
    .slice(0, 8)
    .map(
      (row) =>
        `<tr><td>${escapeHtml(row.label)}</td><td style="text-align:right;font-weight:700">${row.count}</td><td style="text-align:right">${row.pct}%</td></tr>`,
    )
    .join('');
}

function pieLegendHtml(pie) {
  return (pie ?? [])
    .filter((s) => s.count > 0)
    .map(
      (s) =>
        `<tr><td><span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${escapeHtml(s.color)}"></span> ${escapeHtml(s.label)}</td><td style="text-align:right">${s.count} (${s.pct}%)</td></tr>`,
    )
    .join('');
}

export function buildQuestMailReportEmailHtml(report) {
  const lc = report.lead_cycle ?? {};
  const ov = lc.overview ?? {};
  const pl = lc.pipeline ?? {};
  const sc = lc.scorecard ?? {};
  const summary = report.summary ?? {};
  const kind = report.cycle?.report_type || report.cycle?.kind || 'monday';
  const title = kind === 'friday' ? 'QuestMail Friday Report' : 'QuestMail Monday Report';
  const reportUrl = (
    process.env.QUESTMAIL_REPORT_BASE_URL || 'https://questrock-inbound-api.vercel.app/questmail-report/'
  ).replace(/\/$/, '');

  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"></head>
<body style="font-family:Helvetica,Arial,sans-serif;background:#e8edf3;padding:24px;color:#1e293b">
  <div style="max-width:720px;margin:0 auto;background:#fff;border:1px solid #cbd5e1;border-radius:14px;overflow:hidden">
    <div style="background:linear-gradient(135deg,#0c2340,#163a63);color:#fff;padding:24px 28px;border-bottom:4px solid #c9a227">
      <p style="margin:0 0 8px;font-size:11px;letter-spacing:1.5px;text-transform:uppercase;opacity:0.85">QuestRock QuestMail</p>
      <h1 style="margin:0;font-size:22px">${escapeHtml(title)}</h1>
      <p style="margin:10px 0 0;color:#cbd5e1">${escapeHtml(report.cycle?.label || lc.cycle_label || '')}</p>
    </div>
    <div style="padding:24px 28px">
      <table style="width:100%;border-collapse:collapse;margin-bottom:20px">
        <tr><td style="padding:6px 0">QuestMail calls</td><td style="text-align:right;font-weight:700;font-size:18px">${lc.total_calls ?? report.count ?? 0}</td></tr>
        <tr><td style="padding:6px 0">Unique leads</td><td style="text-align:right;font-weight:700">${lc.total_leads ?? ov.total_questmail_leads ?? 0}</td></tr>
        <tr><td style="padding:6px 0">Advancing</td><td style="text-align:right;font-weight:700;color:#16a34a">${lc.advanced_count ?? 0}</td></tr>
        <tr><td style="padding:6px 0">Live conversations</td><td style="text-align:right;font-weight:700">${summary.talked ?? 0}</td></tr>
        <tr><td style="padding:6px 0">Good outcomes</td><td style="text-align:right;font-weight:700">${summary.good ?? 0}</td></tr>
        <tr><td style="padding:6px 0">Did not advance</td><td style="text-align:right;font-weight:700">${summary.did_not_advance ?? 0}</td></tr>
      </table>

      <h2 style="font-size:14px;text-transform:uppercase;letter-spacing:1px;color:#64748b;margin:0 0 8px">Lead outcomes</h2>
      <table style="width:100%;border-collapse:collapse;margin-bottom:20px;font-size:14px">
        ${pieLegendHtml(ov.pie) || '<tr><td>No categorized leads yet.</td></tr>'}
      </table>

      <h2 style="font-size:14px;text-transform:uppercase;letter-spacing:1px;color:#64748b;margin:0 0 8px">Pipeline</h2>
      <table style="width:100%;border-collapse:collapse;margin-bottom:20px;font-size:14px">
        <thead><tr style="border-bottom:2px solid #e2e8f0;text-align:left"><th>Status</th><th style="text-align:right">Count</th><th style="text-align:right">%</th></tr></thead>
        <tbody>${pipelineRowsHtml(pl) || '<tr><td colspan="3">No pipeline data.</td></tr>'}</tbody>
      </table>

      ${
        sc.management_takeaway
          ? `<div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:14px 16px;margin-bottom:20px">
        <p style="margin:0 0 6px;font-size:12px;font-weight:700;text-transform:uppercase;color:#64748b">Management takeaway</p>
        <p style="margin:0;line-height:1.55">${escapeHtml(sc.management_takeaway)}</p>
      </div>`
          : ''
      }

      ${
        ov.summary
          ? `<p style="margin:0 0 20px;line-height:1.55;color:#475569"><strong>Overview:</strong> ${escapeHtml(ov.summary)}</p>`
          : ''
      }

      <p style="margin:0">
        <a href="${escapeHtml(reportUrl)}?kind=${escapeHtml(kind)}" style="display:inline-block;background:#0c2340;color:#fff;text-decoration:none;padding:10px 18px;border-radius:999px;font-weight:700">Open full QuestMail report</a>
      </p>
      <p style="margin:16px 0 0;font-size:11px;color:#94a3b8">Generated ${escapeHtml(
        new Date(report.generated_at).toLocaleString('en-US', { timeZone: 'America/New_York' }),
      )} ET</p>
    </div>
  </div>
</body></html>`;
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 */
export async function buildQuestMailWeeklyEmailReport(supabase, { kind = 'monday' } = {}) {
  const { buildQuestMailReport } = await import('./questmail-report.js');
  const report = await buildQuestMailReport(supabase, { kind });
  return {
    ...report,
    email_html: buildQuestMailReportEmailHtml(report),
  };
}
