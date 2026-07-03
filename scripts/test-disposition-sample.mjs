#!/usr/bin/env node
/**
 * Test disposition email Zap payload + optional Shape sync for a sample lead.
 *
 * Usage:
 *   node scripts/test-disposition-sample.mjs
 *   node scripts/test-disposition-sample.mjs --send-zap
 *   node scripts/test-disposition-sample.mjs --shape-only
 *   node scripts/test-disposition-sample.mjs --call-answered
 *
 * Env: SHAPE_API_KEY, SHAPE_CRM_ID, ZAPIER_EMAIL_WEBHOOK_URL (for --send-zap)
 */
import { buildDispositionEmail } from '../lib/disposition-email.js';
import { resolveInboundLo } from '../lib/shape/inbound-lo-roster.js';
import { updateShapeLeadFields } from '../lib/shape/client.js';
import { postJsonToZapier } from '../lib/email/zapier-webhook.js';

const SAMPLE = {
  shapeLeadId: '47568',
  firstName: 'Arsalan',
  lastName: 'Rashid',
  leadPhone: '7735559876',
  loName: 'Nikk Smith',
  loExtension: '11815',
  aiStatusLabel: 'Did Not Advance',
};

const args = new Set(process.argv.slice(2));
const sendZap = args.has('--send-zap');
const shapeOnly = args.has('--shape-only');
const callAnswered = args.has('--call-answered');

const lo = resolveInboundLo({
  calleeName: SAMPLE.loName,
  calleeExtension: SAMPLE.loExtension,
});

const disposition = buildDispositionEmail({
  leadId: SAMPLE.shapeLeadId,
  firstName: SAMPLE.firstName,
  lastName: SAMPLE.lastName,
  leadPhone: SAMPLE.leadPhone,
  lo,
  callTime: new Date().toISOString(),
  aiStatusLabel: SAMPLE.aiStatusLabel,
});

const zapPayload = {
  email_to: disposition.email_to,
  email_cc: '',
  email_subject: disposition.email_subject,
  email_html: disposition.email_html,
  email_body: disposition.email_html,
  email_from: disposition.email_from,
  email_from_name: disposition.email_from_name,
  email_from_display: disposition.email_from_display,
  template: 'lo_disposition',
  source: 'questrock-inbound-api-test',
  shape_lead_id: SAMPLE.shapeLeadId,
  call_id: `test-${SAMPLE.shapeLeadId}-manual`,
  lo_name: lo.displayName,
  lo_email: lo.email,
  lead_name: `${SAMPLE.firstName} ${SAMPLE.lastName}`,
  lead_phone: '(773) 555-9876',
};

console.log('--- Zap payload (map in Zapier: To, Subject, Body, From) ---');
console.log(JSON.stringify(zapPayload, null, 2));

if (shapeOnly || args.size === 0) {
  const shapeResult = await updateShapeLeadFields(SAMPLE.shapeLeadId, {
    mstrstatus1: 'Did Not Advance',
    recent_notes: '[TEST] scripts/test-disposition-sample.mjs — safe to ignore',
  });
  console.log('\n--- Shape update ---');
  console.log(JSON.stringify(shapeResult, null, 2));
}

if (sendZap) {
  const url = process.env.ZAPIER_EMAIL_WEBHOOK_URL?.trim();
  if (!url) {
    console.error('\nSet ZAPIER_EMAIL_WEBHOOK_URL to send to Zapier.');
    process.exit(1);
  }
  const res = await postJsonToZapier(url, zapPayload, {
    excludeFromQuery: ['email_html', 'email_body'],
  });
  const text = await res.text();
  console.log('\n--- Zapier ---');
  console.log('status:', res.status);
  console.log('response:', text.slice(0, 300));
}

if (callAnswered) {
  const callId = `test-${SAMPLE.shapeLeadId}-${Date.now()}`;
  const body = {
    event: 'phone.callee_answered',
    payload: {
      object: {
        call_id: callId,
        caller: {
          phone_number: '+17735559876',
          name: `${SAMPLE.firstName} ${SAMPLE.lastName}`,
        },
        callee: {
          name: SAMPLE.loName,
          extension_number: SAMPLE.loExtension,
          phone_number: '+14708901236',
        },
        answer_start_time: new Date().toISOString(),
      },
    },
  };
  const base =
    process.env.INBOUND_API_BASE_URL?.trim() || 'https://questrock-inbound-api.vercel.app';
  const res = await fetch(`${base.replace(/\/$/, '')}/api/call-answered`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(process.env.ZAPIER_WEBHOOK_SECRET
        ? { 'x-zapier-secret': process.env.ZAPIER_WEBHOOK_SECRET }
        : {}),
    },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  console.log('\n--- call-answered ---');
  console.log('status:', res.status);
  console.log(JSON.stringify(json, null, 2));
}
