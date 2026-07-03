import { getSupabaseClient } from '../lib/supabase.js';
import { sendJson } from '../lib/http.js';
import { buildWeeklyCallTrackerReport } from '../lib/call-tracker/weekly-report.js';
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
    process.env.CALL_TRACKER_WEEKLY_REPORT_EMAIL?.trim() ||
    process.env.ADMIN_NOTIFICATION_EMAIL?.trim() ||
    'arashid@questrock.com';
  const cc =
    process.env.CALL_TRACKER_WEEKLY_REPORT_CC?.trim() ||
    process.env.ADMIN_NOTIFICATION_CC?.trim() ||
    'nikksmith@questrock.com';
  return { to, cc };
}

/**
 * GET /api/call-tracker-weekly-report?kind=monday|friday
 * Vercel cron — Monday prior-week summary, Friday week-to-date summary.
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

    const report = await buildWeeklyCallTrackerReport(getSupabaseClient(), { kind });
    const { to, cc } = reportRecipients();

    const subjectPrefix = kind === 'friday' ? 'Call Tracker Friday Report' : 'Call Tracker Monday Report';
    const emailSend = await sendEmail({
      to,
      cc,
      subject: `${subjectPrefix}: ${report.summary.total_calls} calls · ${report.window.label}`,
      html: report.email_html,
      template: 'call_tracker_weekly',
      meta: {
        report_kind: kind,
        total_calls: report.summary.total_calls,
        since: report.window.since,
        until: report.window.until,
      },
    });

    return sendJson(res, 200, {
      ok: true,
      ...report,
      email: emailSend,
    });
  } catch (error) {
    console.error('[call-tracker-weekly-report] failed:', error);
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
