import { listInboundCalls } from './list-calls.js';
import { resolveWeeklyReportWindow } from './report-cycle.js';

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/"/g, '&quot;');
}

function channelCounts(calls) {
  const counts = { questmail: 0, inbound_zoom: 0, shape_inbound: 0, other: 0 };
  for (const call of calls) {
    const key = call.call_channel || 'other';
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

function dispositionCounts(calls) {
  const counts = {};
  for (const call of calls) {
    const label = call.lo_disposition_label || call.ai_status_label || 'Pending';
    counts[label] = (counts[label] ?? 0) + 1;
  }
  return counts;
}

function buildSummary(calls) {
  const channels = channelCounts(calls);
  const dispositions = dispositionCounts(calls);
  let withTranscript = 0;
  let aiReviewed = 0;
  let loDispositioned = 0;

  for (const call of calls) {
    if (call.transcript_text) withTranscript += 1;
    if (call.ai_review_complete) aiReviewed += 1;
    if (call.lo_disposition_label) loDispositioned += 1;
  }

  return {
    total_calls: calls.length,
    with_transcript: withTranscript,
    ai_reviewed: aiReviewed,
    lo_dispositioned: loDispositioned,
    channels,
    dispositions,
  };
}

function renderCountRows(counts) {
  return Object.entries(counts)
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([label, n]) => `<tr><td>${escapeHtml(label)}</td><td style="text-align:right;font-weight:700">${n}</td></tr>`)
    .join('');
}

function renderCallRows(calls, limit = 25) {
  return calls.slice(0, limit).map((call) => {
    const status = call.lo_disposition_label || call.ai_status_label || '—';
    return `<tr>
      <td>${escapeHtml(call.borrower_name)}</td>
      <td>${escapeHtml(call.phone || '—')}</td>
      <td>${escapeHtml(call.channel_label || call.call_channel)}</td>
      <td>${escapeHtml(call.lo_name || '—')}</td>
      <td>${escapeHtml(status)}</td>
    </tr>`;
  }).join('');
}

export function buildWeeklyReportEmailHtml({ window, summary, calls, generatedAt }) {
  const deskUrl = (process.env.CALL_TRACKER_BASE_URL || 'https://questrock-inbound-api.vercel.app/call-tracker/').replace(
    /\/$/,
    '',
  );

  const title =
    window.kind === 'friday' ? 'Call Tracker — Friday week-to-date report' : 'Call Tracker — Monday weekly report';

  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"></head>
<body style="font-family:Helvetica,Arial,sans-serif;background:#f1f5f9;padding:24px;color:#0f172a">
  <div style="max-width:720px;margin:0 auto;background:#fff;border:1px solid #e2e8f0;border-radius:14px;overflow:hidden">
    <div style="background:#0f172a;color:#fff;padding:24px 28px">
      <p style="margin:0 0 8px;font-size:11px;letter-spacing:1.5px;text-transform:uppercase;opacity:0.7">QuestRock Call Tracker</p>
      <h1 style="margin:0;font-size:22px">${escapeHtml(title)}</h1>
      <p style="margin:10px 0 0;color:#94a3b8">${escapeHtml(window.label)}</p>
    </div>
    <div style="padding:24px 28px">
      <table style="width:100%;border-collapse:collapse;margin-bottom:20px">
        <tr><td style="padding:6px 0">Total calls</td><td style="text-align:right;font-weight:700;font-size:18px">${summary.total_calls}</td></tr>
        <tr><td style="padding:6px 0">With transcript</td><td style="text-align:right;font-weight:700">${summary.with_transcript}</td></tr>
        <tr><td style="padding:6px 0">QuestRock AI reviewed</td><td style="text-align:right;font-weight:700">${summary.ai_reviewed}</td></tr>
        <tr><td style="padding:6px 0">LO disposition recorded</td><td style="text-align:right;font-weight:700">${summary.lo_dispositioned}</td></tr>
      </table>

      <h2 style="font-size:14px;text-transform:uppercase;letter-spacing:1px;color:#64748b;margin:0 0 8px">By channel</h2>
      <table style="width:100%;border-collapse:collapse;margin-bottom:20px;font-size:14px">
        ${renderCountRows(summary.channels)}
      </table>

      <h2 style="font-size:14px;text-transform:uppercase;letter-spacing:1px;color:#64748b;margin:0 0 8px">By status</h2>
      <table style="width:100%;border-collapse:collapse;margin-bottom:24px;font-size:14px">
        ${renderCountRows(summary.dispositions)}
      </table>

      <h2 style="font-size:14px;text-transform:uppercase;letter-spacing:1px;color:#64748b;margin:0 0 8px">Recent calls</h2>
      <table style="width:100%;border-collapse:collapse;font-size:13px">
        <thead>
          <tr style="border-bottom:2px solid #e2e8f0;text-align:left">
            <th style="padding:8px 4px">Borrower</th>
            <th style="padding:8px 4px">Phone</th>
            <th style="padding:8px 4px">Channel</th>
            <th style="padding:8px 4px">LO</th>
            <th style="padding:8px 4px">Status</th>
          </tr>
        </thead>
        <tbody>${renderCallRows(calls)}</tbody>
      </table>
      ${calls.length > 25 ? `<p style="margin:12px 0 0;font-size:12px;color:#64748b">Showing 25 of ${calls.length} calls.</p>` : ''}

      <p style="margin:24px 0 0">
        <a href="${escapeHtml(deskUrl)}" style="display:inline-block;background:#16a34a;color:#fff;text-decoration:none;padding:10px 18px;border-radius:999px;font-weight:700">Open Call Tracker</a>
      </p>
      <p style="margin:16px 0 0;font-size:11px;color:#94a3b8">Generated ${escapeHtml(new Date(generatedAt).toLocaleString('en-US', { timeZone: 'America/New_York' }))} ET</p>
    </div>
  </div>
</body></html>`;
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 */
export async function buildWeeklyCallTrackerReport(supabase, { kind = 'monday' } = {}) {
  const window = resolveWeeklyReportWindow(kind);
  const raw = await listInboundCalls(supabase, {
    since: window.since,
    until: window.until,
    limit: 500,
    includeArchived: false,
  });

  const calls = raw.calls ?? [];
  const summary = buildSummary(calls);
  const generatedAt = new Date().toISOString();

  return {
    generated_at: generatedAt,
    window,
    summary,
    calls,
    count: calls.length,
    email_html: buildWeeklyReportEmailHtml({ window, summary, calls, generatedAt }),
  };
}
