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
  return `<!DOCTYPE html><html><body style="font-family:Helvetica,Arial,sans-serif;padding:24px;max-width:640px;">
<div style="background:#111827;color:#fff;padding:20px 24px;border-radius:12px 12px 0 0;">
<p style="margin:0 0 6px;font-size:11px;letter-spacing:1.5px;text-transform:uppercase;opacity:0.8">Shape CRM · LO Note</p>
<h2 style="margin:0;font-size:20px;">LO disposition note submitted</h2>
</div>
<div style="border:1px solid #e5e7eb;border-top:none;padding:24px;border-radius:0 0 12px 12px;background:#fff;">
<p style="margin:0 0 16px;line-height:1.55"><strong>${esc(loName)}</strong> dispositioned <strong>${esc(leadName)}</strong> (${esc(leadPhone)})</p>
<p style="margin:0 0 8px"><strong>Status:</strong> ${esc(statusLabel)}</p>
<p style="margin:0 0 16px"><strong>Lead ID:</strong> #${esc(leadId)}</p>
${
  note
    ? `<div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:14px 16px;">
<p style="margin:0 0 6px;font-size:11px;font-weight:700;color:#6b7280;text-transform:uppercase">LO Note</p>
<p style="margin:0;line-height:1.55;white-space:pre-wrap">${esc(note)}</p>
</div>`
    : ''
}
<p style="margin:16px 0 0;color:#6b7280;font-size:12px;">Saved to Call Tracker · Shape CRM updated</p>
</div>
</body></html>`;
}

/**
 * POST /api/disposition-record
 * LO submitted status (+ optional note) from disposition portal → Call Tracker + Shape.
 * Admin email (sam / arashid / nikk) fires only when LO submits a note.
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
    const noteText = String(body.note ?? '').trim();

    const result = await recordLoDisposition(supabase, body);
    const statusLabel = labelFromDispositionSlug(result.lo_disposition_status);

    let adminSend = {
      sent: false,
      skipped: true,
      reason: 'Admin email sends when LO submits a note (not on status-only click).',
    };

    if (noteText.length > 0) {
      const { to, cc } = adminRecipients();
      adminSend = await sendEmail({
        to,
        cc,
        subject: `LO Disposition Note: ${body.leadName || 'Lead'} → ${statusLabel} (#${body.leadId})`,
        html: buildAdminDispositionHtml({
          leadName: body.leadName,
          leadPhone: body.leadPhone,
          leadId: body.leadId,
          loName: body.loName,
          statusLabel,
          note: noteText,
        }),
        template: 'lo_disposition_admin',
        meta: {
          email_phase: 'lo_note_admin',
          shape_lead_id: body.leadId,
          call_id: result.call_id,
          lo_name: body.loName,
          lo_email: body.loEmail ?? null,
          lead_name: body.leadName,
          lead_phone: body.leadPhone,
          lo_disposition_status: result.lo_disposition_status,
          lo_disposition_label: statusLabel,
          lo_disposition_note: noteText,
        },
      });
    }

    return sendJson(res, 200, {
      ok: true,
      ...result,
      call_tracker_saved: Boolean(result.transcript_id),
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
