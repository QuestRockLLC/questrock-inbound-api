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

/**
 * Builds LO disposition email for Gmail / Email by Zapier.
 */
export function buildDispositionEmail({
  leadId,
  firstName,
  lastName,
  leadPhone,
  lo,
  callTime,
  baseUrl,
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
      ? new Date(callTime).toLocaleString('en-US', { timeZone: 'America/New_York' })
      : new Date().toLocaleString('en-US', { timeZone: 'America/New_York' });

  function link(status) {
    return `${base_url}/disposition?leadId=${q(leadId)}&status=${q(status)}&lo=${q(loId)}&leadName=${q(lead_name)}&leadPhone=${q(lead_phone)}&loName=${q(lo.displayName)}`;
  }

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
<h1 style="margin:0 0 6px 0;font-size:26px;font-weight:700;color:#ffffff;">New lead needs your disposition</h1>
<p style="margin:0;font-size:14px;color:#9CA3AF;">${escapeHtml(callTimeDisplay)}</p>
</td></tr></table>
<table width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
<td style="background-color:#F9FAFB;border-top:1px solid #E5E7EB;border-bottom:1px solid #E5E7EB;padding:20px 40px;">
<p style="margin:0 0 2px 0;font-size:15px;font-weight:700;color:#111827;">${lead_name_safe}</p>
<p style="margin:0;font-size:13px;color:#6B7280;">${lead_phone}</p>
<p style="margin:12px 0 0;font-size:14px;font-weight:600;color:#111827;">Assigned to ${lo_display_safe} · #${escapeHtml(leadId)}</p>
</td></tr></table>
<table width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td style="padding:24px 40px;">
<table width="100%" cellpadding="0" cellspacing="0"><tr>
<td width="49%"><a href="${link('first_call_appt')}" style="display:block;background:#16A34A;color:#fff;text-decoration:none;padding:14px;border-radius:10px;font-weight:700;">First Call Appt</a></td>
<td width="2%"></td>
<td width="49%"><a href="${link('pitch_appt')}" style="display:block;background:#15803D;color:#fff;text-decoration:none;padding:14px;border-radius:10px;font-weight:700;">Pitch Appt</a></td>
</tr><tr><td colspan="3" style="height:10px"></td></tr><tr>
<td width="49%"><a href="${link('turndown')}" style="display:block;background:#DC2626;color:#fff;text-decoration:none;padding:14px;border-radius:10px;font-weight:700;">Turndown</a></td>
<td width="2%"></td>
<td width="49%"><a href="${link('missed_appt')}" style="display:block;background:#B91C1C;color:#fff;text-decoration:none;padding:14px;border-radius:10px;font-weight:700;">Missed Appt</a></td>
</tr><tr><td colspan="3" style="height:10px"></td></tr><tr>
<td width="49%"><a href="${link('not_contacted')}" style="display:block;background:#EA580C;color:#fff;text-decoration:none;padding:14px;border-radius:10px;font-weight:700;">Not Contacted</a></td>
<td width="2%"></td>
<td width="49%"><a href="${link('help_requested')}" style="display:block;background:#7C3AED;color:#fff;text-decoration:none;padding:14px;border-radius:10px;font-weight:700;">Help Requested</a></td>
</tr></table>
</td></tr></table>
</td></tr></table>
</td></tr></table>
</body></html>`;

  return {
    email_html,
    email_body: email_html,
    email_to: lo.email,
    email_subject: `Disposition: ${lead_name} (#${leadId})`,
    debug_lo_id: loId,
    debug_lead_name: lead_name,
    initials,
  };
}
