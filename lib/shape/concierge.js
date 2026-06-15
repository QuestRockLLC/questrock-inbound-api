/** Shape lead owner for new mailer imports (Concierge desk). */
export const SHAPE_CONCIERGE_USER_ID = Number(
  process.env.SHAPE_CONCIERGE_USER_ID || process.env.SHAPE_CONCIERGE_SHAPE_ID || 31,
);

export const MAILER_CONCIERGE_LO_NAME = String(
  process.env.MAILER_CONCIERGE_LO_NAME || 'Concierge',
).trim();
