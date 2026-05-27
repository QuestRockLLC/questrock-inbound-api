function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Builds HTML + plain metadata for admin notification emails (Zapier Gmail step).
 */
export function buildAdminOutcomeEmail({
  lead,
  evaluation,
  transcript,
  loName,
  shapeSync,
}) {
  const statusLabel = evaluation.status.status_label;
  const statusColor = evaluation.status.color ?? '#6b7280';
  const leadName = lead.full_name || 'Unknown Caller';
  const phone = lead.phone_number || 'N/A';
  const shapeLeadId = lead.shape_lead_id || 'N/A';

  const email_subject = `AI Call Outcome: ${leadName} → ${statusLabel}`;
  const email_to = process.env.ADMIN_NOTIFICATION_EMAIL || 'sam@questrock.com';
  const email_cc = process.env.ADMIN_NOTIFICATION_CC || 'nikksmith@questrock.com';

  const populatedEntries = Object.entries(evaluation.fieldsPopulated ?? {}).filter(
    ([, value]) => String(value ?? '').trim() !== '',
  );

  const fieldsHtml = populatedEntries.length
    ? `<ul>${populatedEntries
        .map(
          ([field, value]) =>
            `<li><strong>${escapeHtml(field)}:</strong> ${escapeHtml(value)}</li>`,
        )
        .join('')}</ul>`
    : '<p>No additional Shape fields extracted.</p>';

  const email_html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"></head>
<body style="font-family:Helvetica,Arial,sans-serif;background:#f3f4f6;padding:24px;">
  <div style="max-width:640px;margin:0 auto;background:#fff;border:1px solid #e5e7eb;border-radius:12px;overflow:hidden;">
    <div style="background:#111827;color:#fff;padding:24px;">
      <p style="margin:0 0 8px;font-size:11px;letter-spacing:1.5px;text-transform:uppercase;">QuestRock AI Call Review</p>
      <h1 style="margin:0;font-size:22px;">${escapeHtml(leadName)}</h1>
      <p style="margin:8px 0 0;color:#9ca3af;">Shape Lead #${escapeHtml(shapeLeadId)} · ${escapeHtml(phone)}</p>
    </div>
    <div style="padding:24px;">
      <p style="margin:0 0 8px;font-size:12px;color:#6b7280;text-transform:uppercase;letter-spacing:1px;">AI Status</p>
      <p style="margin:0 0 16px;">
        <span style="display:inline-block;background:${escapeHtml(statusColor)};color:#fff;padding:6px 12px;border-radius:999px;font-weight:700;">
          ${escapeHtml(statusLabel)}
        </span>
      </p>
      <p style="margin:0 0 16px;color:#374151;line-height:1.6;">${escapeHtml(evaluation.callSummary)}</p>
      <p style="margin:0 0 8px;font-size:12px;color:#6b7280;text-transform:uppercase;letter-spacing:1px;">Why</p>
      <p style="margin:0 0 20px;color:#374151;line-height:1.6;">${escapeHtml(evaluation.statusRationale)}</p>
      ${evaluation.salesNotes ? `<p style="margin:0 0 8px;font-size:12px;color:#6b7280;text-transform:uppercase;letter-spacing:1px;">Sales Notes (LO)</p><p style="margin:0 0 20px;color:#374151;line-height:1.6;">${escapeHtml(evaluation.salesNotes)}</p>` : ''}
      ${evaluation.opsNotes ? `<p style="margin:0 0 8px;font-size:12px;color:#6b7280;text-transform:uppercase;letter-spacing:1px;">Operations Notes</p><p style="margin:0 0 20px;color:#374151;line-height:1.6;background:#fef3c7;padding:12px;border-radius:8px;">${escapeHtml(evaluation.opsNotes)}</p>` : ''}
      ${loName ? `<p style="margin:0 0 20px;color:#374151;"><strong>LO:</strong> ${escapeHtml(loName)}</p>` : ''}
      <p style="margin:0 0 8px;font-size:12px;color:#6b7280;text-transform:uppercase;letter-spacing:1px;">Extracted Fields</p>
      ${fieldsHtml}
      <p style="margin:24px 0 8px;font-size:12px;color:#6b7280;text-transform:uppercase;letter-spacing:1px;">Shape CRM Sync</p>
      <p style="margin:0 0 20px;color:#374151;line-height:1.6;">${
        shapeSync?.synced
          ? `Status set to <strong>${escapeHtml(shapeSync.status_sent)}</strong>${shapeSync.fields_sent?.length ? ` · ${shapeSync.fields_sent.length} field(s) updated` : ''}${shapeSync.shape_async_or_queued_hint ? ' (Shape queued — may take a moment to reflect)' : ''}`
          : shapeSync?.skipped
            ? 'Shape sync skipped — API key not configured on Vercel.'
            : `Shape sync failed${shapeSync?.error ? `: ${escapeHtml(shapeSync.error)}` : ''}`
      }</p>
      <p style="margin:0;font-size:12px;color:#9ca3af;">Transcript ID: ${escapeHtml(transcript.transcript_id)}</p>
    </div>
  </div>
</body></html>`;

  return {
    email_subject,
    email_to,
    email_cc,
    email_html,
    email_body: email_html,
    status_label: statusLabel,
    status_color: statusColor,
    call_summary: evaluation.callSummary,
    sales_notes: evaluation.salesNotes,
    ops_notes: evaluation.opsNotes,
    status_rationale: evaluation.statusRationale,
    fields_populated: evaluation.fieldsPopulated,
  };
}
