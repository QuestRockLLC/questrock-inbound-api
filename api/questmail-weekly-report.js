import { getSupabaseClient } from '../lib/supabase.js';
import { sendJson } from '../lib/http.js';
import { buildQuestMailWeeklyEmailReport } from '../lib/call-tracker/questmail-report-email.js';
import { sendEmail } from '../lib/email/send.js';

function assertCronAuthorized(req) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) {
    const error = new Error('CRON_SECRET is not configured on this deployment.');
    error.statusCode = 503;
    throw error;
  }

  const provided =
    req.headers['x-cron-secret'] ||
    req.headers.authorization?.replace(/^Bearer\s+/i, '').trim();

  if (!provided || provided !== secret) {
    const error = new Error('Unauthorized cron request.');
    error.statusCode = 401;
    throw error;
  }
}

function reportRecipients() {
  const to =
    process.env.QUESTMAIL_WEEKLY_REPORT_EMAIL?.trim() ||
    process.env.CALL_TRACKER_WEEKLY_REPORT_EMAIL?.trim() ||
    process.env.ADMIN_NOTIFICATION_EMAIL?.trim() ||
    'arashid@questrock.com';
  const cc =
    process.env.QUESTMAIL_WEEKLY_REPORT_CC?.trim() ||
    process.env.CALL_TRACKER_WEEKLY_REPORT_CC?.trim() ||
    process.env.ADMIN_NOTIFICATION_CC?.trim() ||
    'nikksmith@questrock.com';
  return { to, cc };
}

/**
 * GET /api/questmail-weekly-report?kind=monday|friday
 * Vercel cron — QuestMail Monday prior-week + Friday week-to-date reports.
 */
export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return sendJson(res, 405, { ok: false, error: 'Method not allowed.' });
  }

  try {
    assertCronAuthorized(req);

    const kindParam = String(req.query?.kind ?? req.body?.kind ?? 'monday').trim().toLowerCase();
    const kind = kindParam === 'friday' ? 'friday' : 'monday';

    const report = await buildQuestMailWeeklyEmailReport(getSupabaseClient(), { kind });
    const lc = report.lead_cycle ?? {};
    const { to, cc } = reportRecipients();

    const subjectPrefix = kind === 'friday' ? 'QuestMail Friday Report' : 'QuestMail Monday Report';
    const emailSend = await sendEmail({
      to,
      cc,
      subject: `${subjectPrefix}: ${lc.total_leads ?? 0} leads · ${lc.advanced_count ?? 0} advancing · ${report.cycle?.label || ''}`,
      html: report.email_html,
      template: 'questmail_weekly',
      meta: {
        report_kind: kind,
        total_calls: lc.total_calls ?? report.count,
        total_leads: lc.total_leads,
        since: report.cycle?.since,
        until: report.cycle?.until,
      },
    });

    return sendJson(res, 200, {
      ok: true,
      ...report,
      email: emailSend,
    });
  } catch (error) {
    console.error('[questmail-weekly-report] failed:', error);
    const statusCode = error.statusCode ?? 500;
    return sendJson(res, statusCode, {
      ok: false,
      error: statusCode === 500 ? 'Internal Server Error' : error.message,
    });
  }
}

export const config = {
  maxDuration: 60,
};
