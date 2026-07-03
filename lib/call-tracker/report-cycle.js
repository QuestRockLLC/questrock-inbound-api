const TZ = 'America/New_York';

function etParts(date) {
  const d = date instanceof Date ? date : new Date(date);
  const ymd = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
  const [year, month, day] = ymd.split('-').map(Number);
  const weekday = new Intl.DateTimeFormat('en-US', { timeZone: TZ, weekday: 'short' }).format(d);
  return { year, month, day, weekday };
}

function formatEtLabel(date) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: TZ,
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(date instanceof Date ? date : new Date(date));
}

/** UTC instant for midnight ET on a calendar date (handles DST). */
function midnightEtUtc(year, month, day) {
  let lo = Date.UTC(year, month - 1, day - 1, 4, 0, 0);
  let hi = Date.UTC(year, month - 1, day + 1, 8, 0, 0);

  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    const p = etParts(new Date(mid));
    const hour = Number(
      new Intl.DateTimeFormat('en-US', {
        timeZone: TZ,
        hour: 'numeric',
        hour12: false,
      }).format(new Date(mid)),
    );
    const cmp = p.year * 10000 + p.month * 100 + p.day;
    const target = year * 10000 + month * 100 + day;

    if (cmp < target) {
      lo = mid + 1;
    } else if (cmp > target || hour > 0) {
      hi = mid;
    } else {
      return new Date(mid);
    }
  }

  return new Date(lo);
}

function endOfDayEtUtc(year, month, day) {
  const next = midnightEtUtc(year, month, day + 1);
  return new Date(next.getTime() - 1);
}

function addEtDays(year, month, day, delta) {
  const base = midnightEtUtc(year, month, day);
  const shifted = new Date(base.getTime() + delta * 24 * 60 * 60 * 1000);
  return etParts(shifted);
}

const WEEKDAY_OFFSET = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };

/**
 * Weekly report windows (ET).
 * - monday: prior calendar week Mon 00:00 → Sun 23:59:59
 * - friday: current week Mon 00:00 → now
 */
export function resolveWeeklyReportWindow(kind = 'monday', now = new Date()) {
  const today = etParts(now);
  const daysSinceMonday = WEEKDAY_OFFSET[today.weekday] ?? 0;
  const thisMonday = addEtDays(today.year, today.month, today.day, -daysSinceMonday);

  if (kind === 'friday') {
    const since = midnightEtUtc(thisMonday.year, thisMonday.month, thisMonday.day);
    return {
      kind: 'friday',
      since: since.toISOString(),
      until: now.toISOString(),
      label: `Week to date · ${formatEtLabel(since)} – ${formatEtLabel(now)}`,
    };
  }

  const prevMonday = addEtDays(thisMonday.year, thisMonday.month, thisMonday.day, -7);
  const prevSunday = addEtDays(thisMonday.year, thisMonday.month, thisMonday.day, -1);
  const since = midnightEtUtc(prevMonday.year, prevMonday.month, prevMonday.day);
  const until = endOfDayEtUtc(prevSunday.year, prevSunday.month, prevSunday.day);

  return {
    kind: 'monday',
    since: since.toISOString(),
    until: until.toISOString(),
    label: `Prior week · ${formatEtLabel(since)} – ${formatEtLabel(until)}`,
  };
}
