/**
 * Generate HTML report from transcript audit JSON.
 * Usage:
 *   node scripts/audit-transcript-pii-spanish.mjs > /tmp/audit.json
 *   node scripts/generate-transcript-audit-html.mjs /tmp/audit.json
 */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const inputPath = process.argv[2] || '/tmp/transcript-audit.json';
const outputPath =
  process.argv[3] || resolve(__dirname, '../reports/transcript-audit-report.html');

const data = JSON.parse(readFileSync(inputPath, 'utf8'));

const ACTUAL_PII = [
  'SSN (formatted)',
  'SSN (after "social" cue)',
  'SSN (after "security number" cue)',
  'SSN (after social security/SSN mention)',
  'SSN (last four of social)',
  'SSN (9-digit speaker line)',
  'DOB (after keyword)',
  'DOB (date of birth value)',
  'DOB (speaker line answer)',
];

function hasActualPii(types) {
  return types.some((t) => ACTUAL_PII.includes(t));
}

function fmtDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-US', {
    timeZone: 'America/New_York',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function badge(text, kind) {
  const cls =
    kind === 'danger'
      ? 'badge danger'
      : kind === 'warn'
        ? 'badge warn'
        : kind === 'info'
          ? 'badge info'
          : 'badge';
  return `<span class="${cls}">${esc(text)}</span>`;
}

function piiBadge(type) {
  if (type.includes('formatted') || type.includes('after') || type.includes('9-digit') || type.includes('last four') || type.includes('DOB')) {
    return badge(type, 'danger');
  }
  return badge(type, 'warn');
}

function callTrackerUrl(callId) {
  return `https://questrock-inbound-api.vercel.app/call-tracker/?q=${encodeURIComponent(callId)}`;
}

function personRow(person, priority) {
  const calls = person.calls
    .map(
      (c) => `
      <tr>
        <td>${esc(fmtDate(c.call_date))}</td>
        <td><code>${esc(c.call_id)}</code></td>
        <td>${c.pii_types.map(piiBadge).join(' ')}</td>
        <td><a href="${callTrackerUrl(c.call_id)}" target="_blank" rel="noopener">Open in Call Tracker</a></td>
      </tr>`,
    )
    .join('');

  return `
    <article class="person-card ${priority}">
      <header>
        <h3>${esc(person.borrower_name)}</h3>
        <div class="meta">
          ${person.phone ? `<span>${esc(person.phone)}</span>` : ''}
          ${person.shape_lead_id ? `<span>Shape ${esc(person.shape_lead_id)}</span>` : ''}
          ${person.reference_code ? `<span>Ref ${esc(person.reference_code)}</span>` : ''}
        </div>
      </header>
      <div class="tags">${person.pii_types.map(piiBadge).join(' ')}</div>
      <table>
        <thead><tr><th>Call date</th><th>Call ID</th><th>Issues</th><th></th></tr></thead>
        <tbody>${calls}</tbody>
      </table>
    </article>`;
}

const piiPeople = data.pii_people ?? [];
const actualPii = piiPeople.filter((p) => hasActualPii(p.pii_types));
const reviewOnly = piiPeople.filter((p) => !hasActualPii(p.pii_types));
const spanishCalls = data.spanish_in_transcript ?? [];

const spanishRows = spanishCalls
  .map(
    (c) => `
    <tr>
      <td><strong>${esc(c.borrower_name)}</strong></td>
      <td>${esc(c.phone || '—')}</td>
      <td>${esc(c.shape_lead_id || '—')}</td>
      <td>${esc(c.reference_code || '—')}</td>
      <td>${esc(fmtDate(c.call_date))}</td>
      <td><code>${esc(c.call_id)}</code></td>
      <td>${esc(c.ai_status_label || '—')}</td>
      <td>${esc(c.call_source || '—')}</td>
      <td><a href="${callTrackerUrl(c.call_id)}" target="_blank" rel="noopener">Open</a></td>
    </tr>`,
  )
  .join('');

const generatedAt = new Date().toLocaleString('en-US', {
  timeZone: 'America/New_York',
  dateStyle: 'full',
  timeStyle: 'short',
});

const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Transcript Audit — SSN/DOB &amp; Spanish</title>
  <style>
    :root {
      --bg: #0f1419;
      --surface: #1a2332;
      --surface2: #243044;
      --text: #e7ecf3;
      --muted: #9aa8bc;
      --accent: #4f8cff;
      --danger: #ff6b6b;
      --warn: #ffb347;
      --ok: #5bd69d;
      --border: #2e3d54;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: "Segoe UI", system-ui, -apple-system, sans-serif;
      background: var(--bg);
      color: var(--text);
      line-height: 1.5;
    }
    .wrap { max-width: 1200px; margin: 0 auto; padding: 2rem 1.25rem 4rem; }
    h1 { font-size: 1.75rem; margin: 0 0 0.25rem; }
    .subtitle { color: var(--muted); margin-bottom: 2rem; }
    .stats {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
      gap: 1rem;
      margin-bottom: 2rem;
    }
    .stat {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 1rem 1.1rem;
    }
    .stat .num { font-size: 2rem; font-weight: 700; line-height: 1.1; }
    .stat .label { color: var(--muted); font-size: 0.9rem; }
    section { margin-bottom: 2.5rem; }
    h2 {
      font-size: 1.25rem;
      margin: 0 0 0.35rem;
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }
    .section-desc { color: var(--muted); margin: 0 0 1rem; font-size: 0.95rem; }
    .person-card {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 1rem 1.1rem;
      margin-bottom: 1rem;
    }
    .person-card.priority { border-left: 4px solid var(--danger); }
    .person-card.review { border-left: 4px solid var(--warn); }
    .person-card header {
      display: flex;
      flex-wrap: wrap;
      justify-content: space-between;
      gap: 0.5rem 1rem;
      align-items: baseline;
      margin-bottom: 0.5rem;
    }
    .person-card h3 { margin: 0; font-size: 1.05rem; }
    .meta { display: flex; flex-wrap: wrap; gap: 0.75rem; color: var(--muted); font-size: 0.88rem; }
    .tags { margin-bottom: 0.75rem; display: flex; flex-wrap: wrap; gap: 0.35rem; }
    .badge {
      display: inline-block;
      font-size: 0.75rem;
      padding: 0.15rem 0.5rem;
      border-radius: 999px;
      background: var(--surface2);
      color: var(--text);
    }
    .badge.danger { background: rgba(255,107,107,0.18); color: #ffb4b4; }
    .badge.warn { background: rgba(255,179,71,0.18); color: #ffd59a; }
    .badge.info { background: rgba(79,140,255,0.18); color: #a8c7ff; }
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.88rem;
    }
    th, td {
      text-align: left;
      padding: 0.55rem 0.65rem;
      border-bottom: 1px solid var(--border);
      vertical-align: top;
    }
    th { color: var(--muted); font-weight: 600; }
    code {
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 0.82rem;
      word-break: break-all;
    }
    a { color: var(--accent); text-decoration: none; }
    a:hover { text-decoration: underline; }
    .table-wrap {
      overflow-x: auto;
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 12px;
    }
    .table-wrap table { margin: 0; }
    .table-wrap th:first-child, .table-wrap td:first-child { padding-left: 1rem; }
    .table-wrap th:last-child, .table-wrap td:last-child { padding-right: 1rem; }
    .note {
      background: var(--surface2);
      border-radius: 10px;
      padding: 0.85rem 1rem;
      color: var(--muted);
      font-size: 0.9rem;
      margin-top: 1rem;
    }
    @media print {
      body { background: #fff; color: #111; }
      .person-card, .stat, .table-wrap { border-color: #ccc; background: #fff; }
      a { color: #036; }
    }
  </style>
</head>
<body>
  <div class="wrap">
    <h1>Transcript Audit Report</h1>
    <p class="subtitle">Generated ${esc(generatedAt)} ET · ${piiPeople.length} PII review rows · ${spanishCalls.length} Spanish mentions</p>

    <div class="stats">
      <div class="stat"><div class="num">${actualPii.length}</div><div class="label">Actual SSN/DOB values</div></div>
      <div class="stat"><div class="num">${reviewOnly.length}</div><div class="label">Social/security cues only</div></div>
      <div class="stat"><div class="num">${piiPeople.length}</div><div class="label">Total PII review</div></div>
      <div class="stat"><div class="num">${spanishCalls.length}</div><div class="label">Spanish in transcript</div></div>
    </div>

    <section>
      <h2>🔴 Edit first — actual SSN or DOB in transcript</h2>
      <p class="section-desc">${actualPii.length} borrower(s) with formatted SSN, DOB values, or digits captured after social/security cues.</p>
      ${actualPii.map((p) => personRow(p, 'priority')).join('') || '<p class="section-desc">None found.</p>'}
    </section>

    <section>
      <h2>🟡 Review — "social" or "security number" mentioned</h2>
      <p class="section-desc">${reviewOnly.length} borrower(s) where the transcript mentions social/security intake — check for spoken digits or remove sensitive content.</p>
      ${reviewOnly.map((p) => personRow(p, 'review')).join('') || '<p class="section-desc">None found.</p>'}
    </section>

    <section>
      <h2>🗣️ Spanish mentioned anywhere in transcript</h2>
      <p class="section-desc">${spanishCalls.length} call(s) where the word "spanish", "español", or "espanol" appears in the transcript text.</p>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Borrower</th>
              <th>Phone</th>
              <th>Shape ID</th>
              <th>Ref code</th>
              <th>Call date</th>
              <th>Call ID</th>
              <th>Status</th>
              <th>Source</th>
              <th></th>
            </tr>
          </thead>
          <tbody>${spanishRows || '<tr><td colspan="9">None found.</td></tr>'}</tbody>
        </table>
      </div>
      <p class="note">No actual SSN/DOB values are shown in this report. Use Call Tracker links to open each call and edit the transcript. After deploy, new transcripts auto-redact on save; existing rows still need manual cleanup or a backfill.</p>
    </section>
  </div>
</body>
</html>`;

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, html, 'utf8');
console.log(`Wrote ${outputPath}`);
