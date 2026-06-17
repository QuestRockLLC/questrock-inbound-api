function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function shapeUrl(shapeLeadId) {
  const base = (process.env.SHAPE_PROSPECT_BASE_URL || 'https://secure.setshape.com/prospects').replace(
    /\/$/,
    '',
  );
  return shapeLeadId ? `${base}/${shapeLeadId}` : null;
}

/**
 * Admin alert when QuestMail call was mis-tagged or needs manual Shape cleanup.
 */
export function buildMailerReconcileAlertEmail({
  lead,
  shapeLeadId,
  correctShapeLeadId,
  wrongShapeLeadId,
  mailerRow,
  transcriptText,
  evaluation,
  issue,
  formattedPhone,
}) {
  const email_to =
    process.env.MAILER_RECONCILE_ALERT_EMAIL ||
    process.env.ADMIN_NOTIFICATION_EMAIL ||
    'arashid@questrock.com';
  const email_cc =
    process.env.MAILER_RECONCILE_ALERT_CC || process.env.ADMIN_NOTIFICATION_CC || 'nikksmith@questrock.com';

  const leadName = lead?.full_name || 'Unknown Caller';
  const ref = mailerRow?.reference_code || '—';
  const correctId = correctShapeLeadId || shapeLeadId;
  const wrongId = wrongShapeLeadId;

  const email_subject = wrongId
    ? `QuestMail merge: ${leadName} — delete stray Shape #${wrongId}`
    : `QuestMail alert: ${leadName} (${ref})`;

  const links = [
    correctId ? `<li><a href="${escapeHtml(shapeUrl(correctId))}">Shape lead #${escapeHtml(correctId)} (Mail)</a></li>` : '',
    wrongId ? `<li><a href="${escapeHtml(shapeUrl(wrongId))}">Stray inbound Shape #${escapeHtml(wrongId)} — review/delete</a></li>` : '',
    ref !== '—'
      ? `<li><a href="https://questrock-inbound-api.vercel.app/mailer-lo/?q=${escapeHtml(encodeURIComponent(ref))}">QuestMail LO Desk — ${escapeHtml(ref)}</a></li>`
      : '',
    `<li><a href="https://questrockintelligencehub.vercel.app">Intelligence Hub</a></li>`,
  ]
    .filter(Boolean)
    .join('');

  const email_html = `<!DOCTYPE html>
<html><body style="font-family:Helvetica,Arial,sans-serif;background:#f8fafc;padding:24px;">
  <div style="max-width:640px;margin:0 auto;background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:24px;">
    <h1 style="margin:0 0 8px;font-size:20px;">QuestMail Call Reconciliation</h1>
    <p style="color:#64748b;margin:0 0 16px;">${escapeHtml(leadName)} · ${escapeHtml(formattedPhone || '')}</p>
    <p style="background:#fef3c7;padding:12px;border-radius:8px;line-height:1.5;">${escapeHtml(issue)}</p>
    <p><strong>Offer code:</strong> ${escapeHtml(ref)}</p>
    ${evaluation?.callSummary ? `<p><strong>AI summary:</strong> ${escapeHtml(evaluation.callSummary)}</p>` : ''}
    <ul>${links}</ul>
    <p style="font-size:12px;color:#94a3b8;">Transcript excerpt: ${escapeHtml(String(transcriptText ?? '').slice(0, 400))}…</p>
  </div>
</body></html>`;

  return { email_to, email_cc, email_subject, email_html };
}
