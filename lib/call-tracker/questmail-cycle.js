import { resolveWeeklyReportWindow } from './report-cycle.js';

/** @deprecated Use kind=monday|friday instead of fixed dates. */
export const DEFAULT_QUESTMAIL_CYCLE = {
  label: 'JUN 16 – JUN 23 LEAD CYCLE',
  since: '2026-06-16T04:00:00.000Z',
  until: '2026-06-24T03:59:59.999Z',
};

function formatCycleLabel(window) {
  if (window.kind === 'friday') {
    return `QUESTMAIL FRIDAY REPORT · ${window.label}`;
  }
  return `QUESTMAIL MONDAY REPORT · ${window.label}`;
}

/**
 * QuestMail report window.
 * - kind=monday → prior calendar week (Mon–Sun)
 * - kind=friday → current week to date (Mon–now)
 * - since/until still supported for custom ranges
 */
export function resolveQuestMailCycle(query = {}) {
  const kind = String(query.kind ?? query.report ?? '').trim().toLowerCase();

  if (kind === 'monday' || kind === 'friday') {
    const window = resolveWeeklyReportWindow(kind);
    return {
      since: window.since,
      until: window.until,
      label: formatCycleLabel(window),
      kind: window.kind,
      report_type: kind,
    };
  }

  const hasCustomRange = query.since || query.from || query.until || query.to;
  if (hasCustomRange) {
    const since = query.since || query.from || DEFAULT_QUESTMAIL_CYCLE.since;
    const until = query.until || query.to || DEFAULT_QUESTMAIL_CYCLE.until;
    const label = query.cycle_label || query.label || 'CUSTOM QUESTMAIL CYCLE';
    return {
      since: new Date(since).toISOString(),
      until: new Date(until).toISOString(),
      label,
      kind: 'custom',
      report_type: 'custom',
    };
  }

  return resolveQuestMailCycle({ kind: 'friday' });
}
