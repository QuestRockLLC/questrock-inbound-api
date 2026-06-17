import { normalizePhoneDigits } from '../phone.js';

/** Paid/organic inbound ad landing page numbers (state DIDs on marketing sites). */
export const DEFAULT_INBOUND_LANDING_DIDS = [
  { phone10: '2392419600', state: 'FL', label: 'FL Landing Page', utmCampaign: 'fl-landing-page' },
  { phone10: '6782222021', state: 'GA', label: 'GA Landing Page', utmCampaign: 'ga-landing-page' },
  { phone10: '7042275017', state: 'NC', label: 'NC Landing Page', utmCampaign: 'nc-landing-page' },
  { phone10: '8038812577', state: 'SC', label: 'SC Landing Page', utmCampaign: 'sc-landing-page' },
  { phone10: '6158619441', state: 'TN', label: 'TN Landing Page', utmCampaign: 'tn-landing-page' },
  { phone10: '2102552855', state: 'TX', label: 'TX Landing Page', utmCampaign: 'tx-landing-page' },
];

export function getInboundLandingDids() {
  const raw = process.env.INBOUND_LANDING_DID_JSON?.trim();
  if (!raw) {
    return DEFAULT_INBOUND_LANDING_DIDS;
  }

  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length) {
      return parsed.map((row) => ({
        phone10: normalizePhoneDigits(row.phone10 ?? row.phone ?? ''),
        state: String(row.state ?? '').trim() || null,
        label: String(row.label ?? `${row.state} Landing Page`).trim(),
        utmCampaign: String(row.utmCampaign ?? row.utm_campaign ?? '').trim() || null,
      }));
    }
  } catch {
    // fall through
  }

  return DEFAULT_INBOUND_LANDING_DIDS;
}

export function matchInboundLandingDid(phone) {
  const phone10 = normalizePhoneDigits(phone);
  if (phone10.length !== 10) {
    return null;
  }

  for (const entry of getInboundLandingDids()) {
    if (entry.phone10 === phone10) {
      return entry;
    }
  }

  return null;
}
