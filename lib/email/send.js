/**
 * Outbound email via Resend (https://resend.com).
 * If RESEND_API_KEY is unset, returns { sent: false } — pipeline still succeeds.
 */
export async function sendEmail({ to, cc, subject, html, text }) {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const from = process.env.EMAIL_FROM?.trim() || 'QuestRock <notifications@questrock.com>';

  if (!apiKey) {
    return { sent: false, reason: 'RESEND_API_KEY not configured — email payload returned in API response only' };
  }

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
    return { sent: false, http_status: response.status, error: result.message || JSON.stringify(result) };
  }

  return { sent: true, id: result.id, to: recipients };
}
