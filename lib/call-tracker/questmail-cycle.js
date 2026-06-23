/** Default QuestMail weekly cycle for ops reporting (ET). */
export const DEFAULT_QUESTMAIL_CYCLE = {
  label: 'JUN 16 – JUN 23 LEAD CYCLE',
  /** 2026-06-16 00:00 America/New_York */
  since: '2026-06-16T04:00:00.000Z',
  /** 2026-06-23 23:59:59 America/New_York */
  until: '2026-06-24T03:59:59.999Z',
};

export function resolveQuestMailCycle(query = {}) {
  const since = query.since || query.from || DEFAULT_QUESTMAIL_CYCLE.since;
  const until = query.until || query.to || DEFAULT_QUESTMAIL_CYCLE.until;
  const label = query.cycle_label || query.label || DEFAULT_QUESTMAIL_CYCLE.label;

  return {
    since: new Date(since).toISOString(),
    until: new Date(until).toISOString(),
    label,
  };
}
