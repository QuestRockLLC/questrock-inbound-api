import { STATUS_SLUG_META, slugFromShapeStatusLabel } from './disposition/status-slug.js';

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function q(value) {
  return encodeURIComponent(String(value ?? ''));
}

const BUTTON_STYLES = {
  first_call_appt: { bg: '#16A34A', border: '#15803D', icon: '&#x1F4C5;', title: 'First Call Appt', sub: 'Scheduled' },
  pitch_appt: { bg: '#15803D', border: '#166534', icon: '&#x1F3AF;', title: 'Pitch Appt', sub: 'Scheduled' },
  turndown: { bg: '#DC2626', border: '#B91C1C', icon: '&#x1F6AB;', title: 'Turndown', sub: 'Bad Lead' },
  missed_appt: { bg: '#B91C1C', border: '#991B1B', icon: '&#x1F4F5;', title: 'Missed Appt', sub: 'Rescheduling' },
  not_contacted: { bg: '#EA580C', border: '#C2410C', icon: '&#x23F8;&#xFE0F;', title: 'Not Contacted', sub: 'Did Not Advance' },
  help_requested: { bg: '#7C3AED', border: '#6D28D9', icon: '&#x1F6A8;', title: 'Help Requested', sub: 'Needs Assistance' },
};

const BUTTON_GROUPS = [
  { title: 'Moving Forward', slugs: ['first_call_appt', 'pitch_appt'] },
  { title: 'Dead / Denied', slugs: ['turndown', 'missed_appt'] },
  { title: 'Hold / Urgent', slugs: ['not_contacted', 'help_requested'] },
];

function renderButton(slug, href, suggestedSlug) {
  const style = BUTTON_STYLES[slug];
  const isSuggested = suggestedSlug === slug;
  const ring = isSuggested ? 'box-shadow:0 0 0 3px #FDE047;' : '';
  const badge = isSuggested
    ? '<span style="display:inline-block;background:#FDE047;color:#111827;font-size:9px;font-weight:800;letter-spacing:0.5px;padding:2px 6px;border-radius:4px;margin-bottom:6px;">AI SUGGESTS</span><br>'
    : '';
  return `<a href="${href}" style="display:block;background-color:${style.bg};color:#ffffff;text-decoration:none;padding:16px 18px;border-radius:10px;font-size:13px;font-weight:700;line-height:1.4;border-left:4px solid ${style.border};${ring}">${badge}<span style="font-size:16px;display:block;margin-bottom:4px;">${style.icon}</span>${style.title}<br><span style="font-weight:400;font-size:12px;opacity:0.8;">${style.sub}</span></a>`;
}

/**
 * Builds LO disposition email — links go to disposition portal → note → Shape + Call Tracker.
 */
export function buildDispositionEmail({
  leadId,
  firstName,
  lastName,
  leadPhone,
  lo,
  callTime,
  baseUrl,
  aiStatusLabel,
}) {
  const base_url = String(
    baseUrl ?? process.env.DISPOSITION_BASE_URL ?? 'https://quest-rock-disposition.vercel.app',
  ).replace(/\/$/, '');

  const lead_name = [firstName, lastName].filter(Boolean).join(' ') || 'Unknown Caller';
  const lead_phone = String(leadPhone ?? '').replace(/\D/g, '');
  const lead_name_safe = escapeHtml(lead_name);
  const lo_display_safe = escapeHtml(lo.displayName);
  const loId = lo.dispositionId ?? lo.id ?? 'lo';

  const nameParts = lead_name.split(/\s+/).filter(Boolean);
  const initials =
    nameParts.length >= 2
      ? (nameParts[0][0] + nameParts[nameParts.length - 1][0]).toUpperCase()
      : lead_name.slice(0, 2).toUpperCase() || '?';

  const callTimeDisplay =
    callTime && !Number.isNaN(new Date(callTime).getTime())
      ? new Date(callTime).toISOString()
      : new Date().toISOString();

  const suggestedSlug = aiStatusLabel ? slugFromShapeStatusLabel(aiStatusLabel) : null;
  const suggestedMeta = suggestedSlug ? STATUS_SLUG_META[suggestedSlug] : null;

  function link(status) {
    return `${base_url}/disposition?leadId=${q(leadId)}&status=${q(status)}&lo=${q(loId)}&leadName=${q(lead_name)}&leadPhone=${q(lead_phone)}&loName=${q(lo.displayName)}`;
  }

  const aiBlock = suggestedMeta
    ? `<tr><td style="padding:24px 40px 8px 40px;background:#FFFBEB;border-bottom:1px solid #FDE68A;">
<p style="margin:0 0 8px 0;font-size:11px;font-weight:700;color:#92400E;text-transform:uppercase;letter-spacing:1.5px;">QuestRock AI suggests</p>
<p style="margin:0 0 12px 0;font-size:15px;font-weight:700;color:#111827;">${escapeHtml(aiStatusLabel)}</p>
<p style="margin:0;font-size:13px;color:#6B7280;line-height:1.5;">Tap the highlighted button if you agree. Otherwise pick the status that fits.</p>
</td></tr>`
    : '';

  const buttonSections = BUTTON_GROUPS.map((group) => {
    const cells = group.slugs
      .map((slug, index) => {
        const pad = index === 0 ? 'padding-right:6px;' : 'padding-left:6px;';
        return `<td width="49%" style="${pad}">${renderButton(slug, link(slug), suggestedSlug)}</td>`;
      })
      .join('');
    return `<tr><td style="padding:20px 40px 8px 40px;">
<p style="margin:0 0 16px 0;font-size:11px;font-weight:700;color:#9CA3AF;text-transform:uppercase;letter-spacing:1.5px;">${group.title}</p>
<table width="100%" cellpadding="0" cellspacing="0" border="0"><tr>${cells}</tr></table></td></tr>`;
  }).join('');

  const email_html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Lead Disposition Required</title></head>
<body style="margin:0;padding:0;background-color:#ECEEF1;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#ECEEF1;padding:40px 16px;">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;">
<tr><td align="center" style="padding-bottom:24px;">
<table cellpadding="0" cellspacing="0" border="0"><tr>
<td style="background-color:#111827;border-radius:10px;padding:8px 18px;"><span style="font-size:13px;font-weight:700;color:#ffffff;letter-spacing:1.5px;text-transform:uppercase;">SHAPE CRM</span></td>
<td style="padding-left:10px;"><span style="font-size:12px;color:#9CA3AF;letter-spacing:0.5px;">Disposition Required</span></td>
</tr></table></td></tr>
<tr><td style="background-color:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #E5E7EB;">
<table width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
<td style="background-color:#111827;padding:36px 40px 32px 40px;">
<table width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td>
<table cellpadding="0" cellspacing="0" border="0" style="margin-bottom:16px;"><tr>
<td style="background-color:#22C55E;border-radius:20px;padding:4px 12px;"><span style="font-size:10px;font-weight:700;color:#ffffff;letter-spacing:1.5px;text-transform:uppercase;">CALL ANSWERED</span></td>
<td style="padding-left:10px;"><span style="font-size:12px;color:#6B7280;">${escapeHtml(callTimeDisplay)}</span></td>
</tr></table>
<h1 style="margin:0 0 6px 0;font-size:26px;font-weight:700;color:#ffffff;letter-spacing:-0.5px;line-height:1.2;">New lead needs<br>your disposition</h1>
<p style="margin:0;font-size:14px;color:#9CA3AF;line-height:1.5;">Select a status below. You'll add your note on the next screen.</p>
</td></tr></table></td></tr></table>
<table width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
<td style="background-color:#F9FAFB;border-top:1px solid #E5E7EB;border-bottom:1px solid #E5E7EB;padding:20px 40px;">
<table width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
<td width="40%" style="padding-right:16px;">
<table cellpadding="0" cellspacing="0" border="0"><tr>
<td style="vertical-align:middle;padding-right:12px;">
<div style="width:44px;height:44px;border-radius:50%;background-color:#111827;display:inline-block;text-align:center;line-height:44px;">
<span style="font-size:15px;font-weight:700;color:#ffffff;">${escapeHtml(initials)}</span></div></td>
<td style="vertical-align:middle;">
<p style="margin:0 0 2px 0;font-size:15px;font-weight:700;color:#111827;">${lead_name_safe}</p>
<p style="margin:0;font-size:13px;color:#6B7280;">${escapeHtml(lead_phone)}</p></td>
</tr></table></td>
<td width="1" style="background-color:#E5E7EB;">&nbsp;</td>
<td width="30%" style="padding-left:20px;padding-right:16px;">
<p style="margin:0 0 2px 0;font-size:10px;font-weight:700;color:#9CA3AF;text-transform:uppercase;letter-spacing:1px;">Assigned To</p>
<p style="margin:0;font-size:14px;font-weight:600;color:#111827;">${lo_display_safe}</p></td>
<td width="1" style="background-color:#E5E7EB;">&nbsp;</td>
<td width="28%" style="padding-left:20px;">
<p style="margin:0 0 2px 0;font-size:10px;font-weight:700;color:#9CA3AF;text-transform:uppercase;letter-spacing:1px;">Lead ID</p>
<p style="margin:0;font-size:14px;font-weight:600;color:#111827;">#${escapeHtml(leadId)}</p></td>
</tr></table></td></tr></table>
<table width="100%" cellpadding="0" cellspacing="0" border="0">
${aiBlock}
${buttonSections}
<tr><td style="padding:8px 40px 32px 40px;"></td></tr>
</table>
<table width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
<td style="border-top:1px solid #F3F4F6;padding:20px 40px;background-color:#F9FAFB;border-radius:0 0 16px 16px;">
<table width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
<td><p style="margin:0;font-size:12px;color:#9CA3AF;line-height:1.6;">Automatically generated when a call was answered on your Zoom account.<br><strong style="color:#6B7280;">Do not reply</strong> — this is an automated notification.</p></td>
<td align="right" style="white-space:nowrap;padding-left:16px;"><span style="font-size:11px;color:#D1D5DB;">Shape CRM</span></td>
</tr></table></td></tr></table>
</td></tr>
<tr><td align="center" style="padding-top:20px;"><p style="margin:0;font-size:11px;color:#9CA3AF;">Powered by Zoom + QuestRock</p></td></tr>
</table></td></tr></table>
</body></html>`;

  return {
    email_html,
    email_body: email_html,
    email_to: lo.email,
    email_subject: suggestedMeta
      ? `Disposition: ${lead_name} — AI suggests ${suggestedMeta.label} (#${leadId})`
      : `Disposition: ${lead_name} (#${leadId})`,
    debug_lo_id: loId,
    debug_lead_name: lead_name,
    ai_suggested_slug: suggestedSlug,
    ai_status_label: aiStatusLabel ?? null,
    initials,
  };
}
