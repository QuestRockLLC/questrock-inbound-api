import { getSupabaseClient } from '../lib/supabase.js';
import { assertAuthorized, readJsonBody, sendJson } from '../lib/http.js';
import { recordLoDisposition } from '../lib/disposition/record.js';
import { sendEmail } from '../lib/email/send.js';
import { labelFromDispositionSlug } from '../lib/disposition/status-slug.js';

function adminRecipients() {
  const to =
    process.env.DISPOSITION_NOTIFY_EMAIL?.trim() ||
    process.env.ADMIN_NOTIFICATION_EMAIL?.trim() ||
    'sam@questrock.com';
  const cc =
    process.env.DISPOSITION_NOTIFY_CC?.trim() ||
    process.env.ADMIN_NOTIFICATION_CC?.trim() ||
    'arashid@questrock.com,nikksmith@questrock.com';
  return { to, cc };
}

function buildAdminDispositionHtml({ leadName, leadPhone, leadId, loName, statusLabel, note }) {
  const esc = (s) =>
    String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;');
  return `<!DOCTYPE html><html><body style="font-family:Helvetica,Arial,sans-serif;padding:24px;">
<h2 style="margin:0 0 12px;">LO disposition submitted</h2>
<p><strong>${esc(loName)}</strong> dispositioned <strong>${esc(leadName)}</strong> (${esc(leadPhone)})</p>
<p><strong>Status:</strong> ${esc(statusLabel)}<br><strong>Lead ID:</strong> #${esc(leadId)}</p>
${note ? `<p><strong>Note:</strong><br>${esc(note).replace(/\n/g, '<br>')}</p>` : ''}
<p style="color:#6b7280;font-size:12px;">Recorded in Call Tracker · Shape CRM updated</p>
</body></html>`;
}

/**
 * POST /api/disposition-record
 * LO submitted status + note from disposition portal.
 */
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return sendJson(res, 405, { error: 'Method Not Allowed' });
  }

  try {
    assertAuthorized(req);
    const body = readJsonBody(req);
    const supabase = getSupabaseClient();

    const result = await recordLoDisposition(supabase, body);
    const statusLabel = labelFromDispositionSlug(result.lo_disposition_status);
    const { to, cc } = adminRecipients();

    const adminSend = await sendEmail({
      to,
      cc,
      subject: `LO Disposition: ${body.leadName || 'Lead'} → ${statusLabel} (#${body.leadId})`,
      html: buildAdminDispositionHtml({
        leadName: body.leadName,
        leadPhone: body.leadPhone,
        leadId: body.leadId,
        loName: body.loName,
        statusLabel,
        note: body.note,
      }),
      template: 'lo_disposition_admin',
      meta: {
        shape_lead_id: body.leadId,
        lo_disposition_status: result.lo_disposition_status,
      },
    });

    return sendJson(res, 200, {
      ok: true,
      ...result,
      admin_notify: adminSend,
    });
  } catch (error) {
    console.error('[disposition-record] failed:', error);
    const statusCode = error.statusCode ?? 500;
    return sendJson(res, statusCode, {
      error: statusCode === 500 ? 'Internal Server Error' : error.message,
    });
  }
}

export const config = {
  maxDuration: 30,
};
