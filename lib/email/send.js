/**
 * Outbound email: Zapier Catch Hook → Outlook (single webhook for LO + admin emails).
 *
 * One Zap: Webhooks by Zapier Catch Hook → Microsoft Outlook Send Email
 *
 * Map in Zapier:
 *   To      → email_to
 *   CC      → email_cc
 *   Subject → email_subject
 *   Body    → email_html  (enable HTML)
 *   From    → email_from_display (optional)
 *
 * email_phase distinguishes the two emails on the same hook:
 *   lo_disposition     — call answered; LO picks status (buttons in HTML)
 *   lo_note_admin      — LO submitted note; notify sam / arashid / nikk
 *
 * Env: ZAPIER_EMAIL_WEBHOOK_URL
 */
import { postToZapierCatchHook } from './zapier-webhook.js';

function getZapierEmailWebhookUrl() {
  return (
    process.env.ZAPIER_EMAIL_WEBHOOK_URL?.trim() ||
    process.env.ZAPIER_ADMIN_NOTIFY_WEBHOOK_URL?.trim() ||
    ''
  );
}

function emailPhaseForTemplate(template, meta) {
  if (meta?.email_phase) {
    return meta.email_phase;
  }
  if (template === 'lo_disposition') {
    return 'lo_disposition';
  }
  if (template === 'lo_disposition_admin') {
    return 'lo_note_admin';
  }
  return template || 'generic';
}

async function sendViaZapier({ to, cc, subject, html, text, template, meta }) {
  const url = getZapierEmailWebhookUrl();
  if (!url) {
    return {
      sent: false,
      channel: 'none',
      reason:
        'No email transport — set ZAPIER_EMAIL_WEBHOOK_URL (Outlook via Zapier) or RESEND_API_KEY',
    };
  }

  const recipients = Array.isArray(to) ? to : [to].filter(Boolean);
  if (!recipients.length) {
    return { sent: false, channel: 'zapier', reason: 'No recipient' };
  }

  const htmlBody = html || text || '';
  const metaObj = meta && typeof meta === 'object' ? meta : {};
  const fromName = metaObj.email_from_name || metaObj.lo_name || '';
  const fromEmail = metaObj.email_from || metaObj.lo_email || '';
  const fromDisplay =
    metaObj.email_from_display ||
    (fromName && fromEmail ? `${fromName} <${fromEmail}>` : fromEmail || fromName || '');

  const ccValue = cc ? (Array.isArray(cc) ? cc.join(',') : String(cc)) : '';

  const payload = {
    ...metaObj,
    email_to: recipients.join(','),
    email_cc: ccValue,
    email_subject: String(subject ?? '').trim() || '(no subject)',
    email_html: htmlBody,
    email_body: htmlBody,
    email_from: fromEmail,
    email_from_name: fromName,
    email_from_display: fromDisplay,
    template: template || 'generic',
    source: metaObj.source || 'questrock-inbound-api',
    email_phase: emailPhaseForTemplate(template, metaObj),
  };

  const response = await postToZapierCatchHook(url, payload);

  const responseText = await response.text();

  if (!response.ok) {
    console.error('[email] Zapier webhook failed:', response.status, responseText.slice(0, 500));
    return {
      sent: false,
      channel: 'zapier',
      http_status: response.status,
      error: responseText.slice(0, 500),
    };
  }

  return {
    sent: true,
    channel: 'zapier',
    http_status: response.status,
    to: recipients,
    email_phase: payload.email_phase,
  };
}

export async function sendEmail({ to, cc, subject, html, text, template, meta } = {}) {
  const zapierUrl = getZapierEmailWebhookUrl();
  if (zapierUrl) {
    return sendViaZapier({ to, cc, subject, html, text, template, meta });
  }

  const apiKey = process.env.RESEND_API_KEY?.trim();

  if (apiKey) {
    const from = process.env.EMAIL_FROM?.trim() || 'QuestRock <notifications@questrock.com>';
    const recipients = Array.isArray(to) ? to : [to].filter(Boolean);

    if (!recipients.length) {
      return { sent: false, reason: 'No recipient' };
    }

    const body = {
      from,
      to: recipients,
      subject: String(subject ?? '').trim() || '(no subject)',
      html: html || text || '',
    };

    if (cc) {
      body.cc = Array.isArray(cc) ? cc : [cc];
    }

    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      console.error('[email] Resend failed:', response.status, result);
      return {
        sent: false,
        channel: 'resend',
        http_status: response.status,
        error: result.message || JSON.stringify(result),
      };
    }

    return { sent: true, channel: 'resend', id: result.id, to: recipients };
  }

  return {
    sent: false,
    channel: 'none',
    reason: 'No email transport — set ZAPIER_EMAIL_WEBHOOK_URL (Outlook via Zapier) or RESEND_API_KEY',
  };
}
