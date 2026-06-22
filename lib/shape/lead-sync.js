import { fetchShapeBulkExportPage, normalizeBulkLeadRow } from './bulk-export.js';
import { isShapeSourceExcluded, resolveLeadSourceLabel } from './lead-source-filters.js';
import { upsertLeadFromShapeCall } from '../leads.js';
import { formatPhoneNumber } from '../phone.js';
import { getInboundLoRoster } from './inbound-lo-roster.js';
import { findTranscriptByExternalCallId, insertShapeLeadCreatedEvent } from '../transcripts.js';
import { shapeTrackerCallId } from '../call-tracker/call-id.js';

const WATERMARK_KEY = 'shape_lead_created_sync';
const BOOTSTRAP_HOURS = 24;
const PAGE_DELAY_MS = 400;

const SYNC_FIELDS = [
  'leadid',
  'firstname',
  'lastname',
  'email',
  'phone',
  'leadsource',
  'mstrstatus1',
  'createdDate',
  'depursLo',
  'boraddress',
  'borcity',
  'borstate',
  'borzip',
];

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function buildFullName(lead) {
  const first = String(lead.firstname ?? lead.first_name ?? '').trim();
  const last = String(lead.lastname ?? lead.last_name ?? '').trim();
  const combined = `${first} ${last}`.trim();
  return combined || String(lead.full_name ?? '').trim() || 'Unknown Caller';
}

function parseCreatedDate(lead) {
  const raw = lead.createdDate ?? lead.created_date ?? lead['Created Date'];
  if (!raw) {
    return new Date().toISOString();
  }
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
}

function resolveLoByDepursLo(depursLo) {
  const id = Number(depursLo);
  if (!Number.isFinite(id) || id <= 0) {
    return null;
  }

  const entry = getInboundLoRoster().find((row) => Number(row.depursLo) === id);
  if (!entry) {
    return null;
  }

  return {
    displayName: entry.displayName ?? entry.names?.[0] ?? null,
    email: entry.email ?? null,
    depursLo: entry.depursLo,
  };
}

async function readWatermark(supabase) {
  const { data, error } = await supabase
    .from('shape_sync_watermark')
    .select('value')
    .eq('key', WATERMARK_KEY)
    .maybeSingle();

  if (error) {
    throw error;
  }

  if (data?.value) {
    return new Date(data.value).toISOString();
  }

  return new Date(Date.now() - BOOTSTRAP_HOURS * 60 * 60 * 1000).toISOString();
}

async function writeWatermark(supabase, iso) {
  const { error } = await supabase.from('shape_sync_watermark').upsert(
    {
      key: WATERMARK_KEY,
      value: iso,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'key' },
  );

  if (error) {
    throw error;
  }
}

function dateOnly(iso) {
  return String(iso).slice(0, 10);
}

/**
 * Poll Shape bulk export for newly created leads and insert Call Tracker events.
 */
export async function syncShapeLeadArrivals(supabase) {
  const runStarted = new Date().toISOString();
  const watermarkFrom = await readWatermark(supabase);
  const from = dateOnly(watermarkFrom);
  const to = dateOnly(runStarted);

  const summary = {
    ok: true,
    scanned: 0,
    created: 0,
    skipped: 0,
    errors: [],
    watermark_from: watermarkFrom,
    watermark_to: runStarted,
    date_range: { from, to },
  };

  let pageNumber = 1;
  let hasMore = true;

  while (hasMore && pageNumber <= 40) {
    const page = await fetchShapeBulkExportPage({
      from,
      to,
      pageNumber,
      fields: SYNC_FIELDS,
    });

    for (const raw of page.leads) {
      summary.scanned += 1;
      const lead = normalizeBulkLeadRow(raw);
      const shapeLeadId = String(lead.leadid ?? '').trim();

      if (!shapeLeadId) {
        summary.skipped += 1;
        continue;
      }

      if (isShapeSourceExcluded(lead)) {
        summary.skipped += 1;
        continue;
      }

      const externalCallId = `shape:${shapeLeadId}:created`;
      const existing = await findTranscriptByExternalCallId(supabase, externalCallId);
      if (existing) {
        summary.skipped += 1;
        continue;
      }

      try {
        const fullName = buildFullName(lead);
        const formattedPhone = lead.phone ? formatPhoneNumber(lead.phone) : null;
        const sourceLabel = resolveLeadSourceLabel(lead);
        const lo = resolveLoByDepursLo(lead.depursLo);
        const createdAt = parseCreatedDate(lead);

        const { lead: supabaseLead } = await upsertLeadFromShapeCall(supabase, {
          shapeLeadId,
          fullName,
          phoneNumber: formattedPhone,
          email: lead.email ?? null,
          currentAddress: lead.boraddress ?? lead.prStreetAddress ?? null,
          city: lead.borcity ?? lead.prCity ?? null,
          state: lead.borstate ?? lead.prState ?? null,
          zipCode: lead.borzip ?? lead.prZipCode ?? null,
          leadSource: 'shape_inbound',
        });

        await insertShapeLeadCreatedEvent(supabase, {
          lead: supabaseLead,
          shapeLeadId,
          timestamp: createdAt,
          callMeta: {
            event_type: 'shape_lead_created',
            call_channel: 'shape_inbound',
            call_id: shapeTrackerCallId(shapeLeadId),
            shape_lead_id: shapeLeadId,
            shape_source_label: sourceLabel || 'Shape lead',
            leadsource: sourceLabel || null,
            shape_status: lead.mstrstatus1 ?? null,
            lo_name: lo?.displayName ?? null,
            lo_email: lo?.email ?? null,
            depurs_lo: lo?.depursLo ?? lead.depursLo ?? null,
            synced_at: runStarted,
          },
        });

        summary.created += 1;
      } catch (error) {
        summary.errors.push({
          shape_lead_id: shapeLeadId,
          error: error.message ?? String(error),
        });
      }
    }

    hasMore = page.hasMore;
    pageNumber += 1;
    if (hasMore) {
      await sleep(PAGE_DELAY_MS);
    }
  }

  await writeWatermark(supabase, runStarted);
  return summary;
}
