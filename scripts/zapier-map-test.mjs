#!/usr/bin/env node
/**
 * Send sample payloads to Zapier Catch Hook for field mapping (no Shape/Supabase).
 *
 * Usage:
 *   node scripts/zapier-map-test.mjs
 *   node scripts/zapier-map-test.mjs "https://hooks.zapier.com/hooks/catch/ID/SECRET/"
 *   node scripts/zapier-map-test.mjs --lo-only
 *   node scripts/zapier-map-test.mjs --admin-only
 *
 * Env fallback: ZAPIER_EMAIL_WEBHOOK_URL
 */
import { buildDispositionEmail } from '../lib/disposition-email.js';
import { resolveInboundLo } from '../lib/shape/inbound-lo-roster.js';
import { postToZapierCatchHook } from '../lib/email/zapier-webhook.js';

const args = process.argv.slice(2);
const loOnly = args.includes('--lo-only');
const adminOnly = args.includes('--admin-only');
const urlArg = args.find((a) => a.startsWith('http'));
const webhookUrl = (urlArg || process.env.ZAPIER_EMAIL_WEBHOOK_URL || '').trim();

if (!webhookUrl) {
  console.error('Usage: node scripts/zapier-map-test.mjs <ZAPIER_CATCH_HOOK_URL>');
  console.error('   or: ZAPIER_EMAIL_WEBHOOK_URL=... node scripts/zapier-map-test.mjs');
  process.exit(1);
}

const lo = resolveInboundLo({ calleeName: 'Nikk Smith', calleeExtension: '11815' });
const disposition = buildDispositionEmail({
  leadId: '47568',
  firstName: 'Arsalan',
  lastName: 'Rashid',
  leadPhone: '7735559876',
  lo,
  callTime: new Date().toISOString(),
  aiStatusLabel: 'Did Not Advance',
});

const loPayload = {
  email_to: disposition.email_to,
  email_cc: '',
  email_subject: disposition.email_subject,
  email_html: disposition.email_html,
  email_body: disposition.email_html,
  email_from: disposition.email_from,
  email_from_name: disposition.email_from_name,
  email_from_display: disposition.email_from_display,
  template: 'lo_disposition',
  email_phase: 'lo_disposition',
  source: 'zapier-map-test',
  shape_lead_id: '47568',
  call_id: 'test-map-lo-disposition',
  lo_name: lo.displayName,
  lo_email: lo.email,
  lead_name: 'Arsalan Rashid',
  lead_phone: '(773) 555-9876',
  ai_status_label: 'Did Not Advance',
};

const adminHtml = `<!DOCTYPE html><html><body style="font-family:Helvetica,Arial,sans-serif;padding:24px;">
<h2>LO disposition note submitted (TEST)</h2>
<p><strong>Nikk Smith</strong> dispositioned <strong>Arsalan Rashid</strong> ((773) 555-9876)</p>
<p><strong>Status:</strong> Did Not Advance<br><strong>Lead ID:</strong> #47568</p>
<p><strong>LO Note:</strong><br>This is a test note for Zapier field mapping.</p>
</body></html>`;

const adminPayload = {
  email_to: 'sam@questrock.com',
  email_cc: 'arashid@questrock.com,nikksmith@questrock.com',
  email_subject: 'LO Disposition Note: Arsalan Rashid → Did Not Advance (#47568)',
  email_html: adminHtml,
  email_body: adminHtml,
  email_from: '',
  email_from_name: '',
  email_from_display: '',
  template: 'lo_disposition_admin',
  email_phase: 'lo_note_admin',
  source: 'zapier-map-test',
  shape_lead_id: '47568',
  call_id: 'test-map-lo-note-admin',
  lo_name: 'Nikk Smith',
  lo_email: lo.email,
  lead_name: 'Arsalan Rashid',
  lead_phone: '(773) 555-9876',
  lo_disposition_status: 'did_not_advance',
  lo_disposition_label: 'Did Not Advance',
  lo_disposition_note: 'This is a test note for Zapier field mapping.',
};

async function send(label, payload) {
  console.log(`\n=== ${label} ===`);
  console.log('email_phase:', payload.email_phase);
  console.log('email_to:', payload.email_to);
  console.log('email_subject:', payload.email_subject);
  const res = await postToZapierCatchHook(webhookUrl, payload);
  const text = await res.text();
  console.log('HTTP', res.status, text.slice(0, 200));
  if (!res.ok) {
    console.error('FAILED — check hook URL is active (Catch Hook from a turned-on Zap draft).');
  } else {
    console.log('OK — refresh Zapier trigger test to see fields.');
  }
}

console.log('Hook:', webhookUrl);

if (!adminOnly) {
  await send('Email 1 — LO disposition (call answered)', loPayload);
}

if (!loOnly) {
  await send('Email 2 — Admin note (LO submitted note)', adminPayload);
}

console.log('\nMap in Outlook step: To=email_to, CC=email_cc, Subject=email_subject, Body=email_html');
