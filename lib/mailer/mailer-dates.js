const EST_TIME_ZONE = 'America/New_York';

const MONTH_INDEX = {
  january: 0,
  jan: 0,
  february: 1,
  feb: 1,
  march: 2,
  mar: 2,
  april: 3,
  apr: 3,
  may: 4,
  june: 5,
  jun: 5,
  july: 6,
  jul: 6,
  august: 7,
  aug: 7,
  september: 8,
  sep: 8,
  sept: 8,
  october: 9,
  oct: 9,
  november: 10,
  nov: 10,
  december: 11,
  dec: 11,
};

/**
 * Parse mailer spreadsheet date strings (m/d/yyyy, ISO, "June 1, 2026", Excel serial).
 */
export function parseMailerDate(value) {
  const raw = String(value ?? '').trim();
  if (!raw) {
    return null;
  }

  if (/^\d+(\.\d+)?$/.test(raw)) {
    const serial = Number(raw);
    if (serial > 20000 && serial < 100000) {
      const utc = new Date(Date.UTC(1899, 11, 30 + serial, 12, 0, 0));
      if (!Number.isNaN(utc.getTime())) {
        return utc;
      }
    }
  }

  const mdy = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (mdy) {
    const month = Number(mdy[1]);
    const day = Number(mdy[2]);
    const year = Number(mdy[3]);
    const utc = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
    if (!Number.isNaN(utc.getTime())) {
      return utc;
    }
  }

  const named = raw.match(/^([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})$/);
  if (named) {
    const month = MONTH_INDEX[named[1].toLowerCase()];
    if (month !== undefined) {
      const utc = new Date(Date.UTC(Number(named[3]), month, Number(named[2]), 12, 0, 0));
      if (!Number.isNaN(utc.getTime())) {
        return utc;
      }
    }
  }

  const parsed = new Date(raw);
  if (!Number.isNaN(parsed.getTime())) {
    const utc = new Date(
      Date.UTC(parsed.getUTCFullYear(), parsed.getUTCMonth(), parsed.getUTCDate(), 12, 0, 0),
    );
    if (!Number.isNaN(utc.getTime())) {
      return utc;
    }
  }

  return null;
}

/** Format a mailer date for display in US Eastern (EST/EDT). */
export function formatMailerDateEst(value) {
  const raw = String(value ?? '').trim();
  if (!raw) {
    return null;
  }

  const parsed = parseMailerDate(raw);
  if (!parsed) {
    return raw;
  }

  return new Intl.DateTimeFormat('en-US', {
    timeZone: EST_TIME_ZONE,
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(parsed);
}
