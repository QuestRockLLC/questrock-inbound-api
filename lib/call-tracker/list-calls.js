import { aiReviewFromTranscriptFields } from '../transcript-ai-review.js';
import { resolveCallDisplay } from './resolve-call-display.js';
import { slugFromShapeStatusLabel } from '../disposition/status-slug.js';

function parseCallId(externalCallId) {
  const raw = String(externalCallId ?? '');
  if (raw.endsWith(':answered')) {
    return raw.slice(0, -':answered'.length);
  }
  if (raw.endsWith(':transcript')) {
    return raw.slice(0, -':transcript'.length);
  }
  if (raw.endsWith(':created')) {
    return raw.slice(0, -':created'.length);
  }
  return raw;
}

function shapeProspectUrl(shapeLeadId) {
  const base = (process.env.SHAPE_PROSPECT_BASE_URL || 'https://secure.setshape.com/prospects').replace(
    /\/$/,
    '',
  );
  return shapeLeadId ? `${base}/${shapeLeadId}` : null;
}

function channelFromMeta(meta, lead, callSource) {
  if (meta.call_channel) {
    return meta.call_channel;
  }
  if (lead?.lead_source === 'questmail' || callSource === 'QuestMail') {
    return 'questmail';
  }
  return 'inbound_zoom';
}

function formatChannel(channel, meta) {
  if (channel === 'shape_inbound') {
    const source = meta?.shape_source_label || meta?.leadsource || 'Shape lead';
    return { key: 'shape_inbound', label: source };
  }
  if (channel === 'questmail') {
    const label = meta?.questmail_label || (meta?.questmail_state ? `QuestMail ${meta.questmail_state}` : 'QuestMail');
    const type = meta?.questmail_type ? ` · ${meta.questmail_type}` : '';
    return { key: 'questmail', label: `${label}${type}` };
  }
  if (meta?.landing_page_label) {
    return { key: 'inbound_zoom', label: meta.landing_page_label };
  }
  return { key: 'inbound_zoom', label: 'Inbound Ads' };
}

function formatPhone10(phone10) {
  const d = String(phone10 ?? '').replace(/\D/g, '').slice(-10);
  if (d.length !== 10) return phone10 || null;
  return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
}

function normalizeLead(row) {
  return Array.isArray(row?.leads) ? row.leads[0] : row?.leads ?? {};
}

/** True when AI evaluation persisted review fields on the transcript row (not just default status copy). */
function hasTranscriptAiReview(transcriptRow) {
  if (!transcriptRow?.transcript_text?.trim()) {
    return false;
  }
  const fields = transcriptRow.fields_populated ?? {};
  if (String(fields.call_summary ?? '').trim()) {
    return true;
  }
  if (String(fields.status_rationale ?? '').trim()) {
    return true;
  }
  const qa = fields.questrock_analysis;
  if (qa && typeof qa === 'object' && Object.values(qa).some((v) => String(v ?? '').trim())) {
    return true;
  }
  if (fields.shape_sync && typeof fields.shape_sync === 'object') {
    return true;
  }
  return false;
}

function buildCallRecord({
  callId,
  answeredAt,
  meta,
  lead,
  callSource,
  transcriptRow,
  missingAnsweredRow = false,
}) {
  const channelKey = channelFromMeta(meta, lead, callSource);
  const channelInfo = formatChannel(channelKey, meta);
  const landingState = meta.landing_page_state || meta.questmail_state || null;
  const aiReview = aiReviewFromTranscriptFields(transcriptRow?.fields_populated);
  const transcriptText = transcriptRow?.transcript_text?.trim() || null;
  const aiReviewComplete = hasTranscriptAiReview(transcriptRow);
  const aiStatus = aiReviewComplete
    ? transcriptRow?.ai_status_label || lead.current_status_label || null
    : null;
  const aiColor = aiReviewComplete
    ? transcriptRow?.ai_status_color || lead.current_status_color || null
    : null;
  const questmailHold = Boolean(meta.questmail_hold);
  const shapeArrival = channelKey === 'shape_inbound';
  const loDispositionStatus = meta.lo_disposition_status || null;
  const loDispositionLabel = meta.lo_disposition_label || null;
  const loDispositionNote = meta.lo_disposition_note || null;
  const loDispositionAt = meta.lo_disposition_at || null;
  const dispositionEmailSentAt = meta.disposition_email_sent_at || null;
  const pendingDisposition = Boolean(meta.pending_disposition);
  const aiSuggestedSlug = aiStatus ? slugFromShapeStatusLabel(aiStatus) : null;
  const loDispositionMismatch =
    Boolean(aiSuggestedSlug && loDispositionStatus && aiSuggestedSlug !== loDispositionStatus);
  const transcriptState = transcriptText
    ? aiReviewComplete
      ? 'reviewed'
      : 'needs_ai'
    : transcriptRow
      ? 'processing'
      : questmailHold
        ? 'awaiting_identification'
        : shapeArrival
          ? 'awaiting_call'
          : missingAnsweredRow
            ? 'needs_ai'
            : 'pending';

  return {
    call_id: callId,
    answered_at: answeredAt,
    call_channel: channelKey,
    channel_label: channelInfo.label,
    landing_page_state: landingState,
    landing_page_label: meta.landing_page_label || null,
    questmail_label: meta.questmail_label || null,
    questmail_type: meta.questmail_type || null,
    questmail_toll: meta.questmail_toll || null,
    questmail_hold: questmailHold,
    missing_answered_row: missingAnsweredRow,
    is_shape_arrival: shapeArrival,
    shape_source_label: meta.shape_source_label || meta.leadsource || null,
    utm_campaign: meta.utm_campaign || null,
    dialed_number: meta.dialed_number || null,
    dialed_number_display: formatPhone10(meta.dialed_number),
    borrower_name: lead.full_name || 'Unknown Caller',
    phone: lead.phone_number || null,
    shape_lead_id: lead.shape_lead_id || meta.shape_lead_id || null,
    shape_url: shapeProspectUrl(lead.shape_lead_id || meta.shape_lead_id),
    reference_code: lead.reference_code || meta.reference_code || null,
    mailer_desk_url: (lead.reference_code || meta.reference_code)
      ? `https://questrock-inbound-api.vercel.app/mailer-lo/?q=${encodeURIComponent(lead.reference_code || meta.reference_code)}`
      : null,
    lo_name: meta.lo_name || null,
    lo_email: meta.lo_email || null,
    contact_found: Boolean(meta.contact_found),
    pending_disposition: pendingDisposition,
    disposition_email_sent_at: dispositionEmailSentAt,
    ai_status_label: aiStatus,
    ai_status_color: aiColor,
    lo_disposition_status: loDispositionStatus,
    lo_disposition_label: loDispositionLabel,
    lo_disposition_note: loDispositionNote,
    lo_disposition_at: loDispositionAt,
    lo_disposition_mismatch: loDispositionMismatch,
    ai_review_complete: aiReviewComplete,
    transcript_state: transcriptState,
    transcript_id: transcriptRow?.transcript_id ?? null,
    transcript_at: transcriptRow?.timestamp ?? null,
    transcript_text: transcriptText,
    needs_ai_analysis: Boolean(transcriptText && !aiReviewComplete),
    needs_mailer_link: channelKey === 'questmail' && (!aiReviewComplete || questmailHold || !lead.reference_code),
    call_summary: aiReview.call_summary,
    sales_notes: aiReview.sales_notes,
    ops_notes: aiReview.ops_notes,
    status_rationale: aiReview.status_rationale,
    questrock_analysis: aiReview.questrock_analysis,
    extracted_fields: aiReview.extracted_fields,
    shape_sync: aiReview.shape_sync,
    lead_status_label: lead.current_status_label || null,
    fields_populated: {
      ...(transcriptRow?.fields_populated ?? {}),
      ...meta,
    },
  };
}

function withResolvedDisplay(record) {
  const display = resolveCallDisplay(record);

  return {
    ...record,
    borrower_name: display.display_name,
    phone: display.display_phone,
    lead_record_name: display.lead_name,
    lead_record_phone: display.lead_phone,
    inbound_questmail_line: display.inbound_line,
    display_name_corrected: display.name_corrected,
    display_name_source: display.name_source,
  };
}

function buildCallRecordResolved(args) {
  return withResolvedDisplay(buildCallRecord(args));
}

function resolveViewLabel(hours) {
  const h = Number(hours);
  if (h <= 24) return 'Today';
  if (h <= 168) return 'Week';
  if (h <= 720) return 'Month';
  return `${h}h`;
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 */
export async function listInboundCalls(
  supabase,
  { limit = 80, channel, state, hours = 24, since: sinceIso, until: untilIso } = {},
) {
  const since =
    sinceIso != null
      ? new Date(sinceIso).toISOString()
      : new Date(Date.now() - Number(hours) * 60 * 60 * 1000).toISOString();
  const until = untilIso != null ? new Date(untilIso).toISOString() : null;
  const maxRows = Math.min(limit, 500);

  let answeredQuery = supabase
    .from('transcripts')
    .select(
      `
      transcript_id,
      timestamp,
      external_call_id,
      call_source,
      fields_populated,
      ai_status_label,
      ai_status_color,
      leads (
        lead_id,
        full_name,
        phone_number,
        shape_lead_id,
        lead_source,
        reference_code,
        current_status_label,
        current_status_color
      )
    `,
    )
    .like('external_call_id', '%:answered')
    .gte('timestamp', since)
    .order('timestamp', { ascending: false })
    .limit(maxRows);

  if (until) {
    answeredQuery = answeredQuery.lte('timestamp', until);
  }

  const { data: answeredRows, error } = await answeredQuery;

  if (error) {
    throw error;
  }

  const transcriptByCallId = new Map();
  let transcriptQuery = supabase
    .from('transcripts')
    .select(
      `
      transcript_id,
      external_call_id,
      ai_status_label,
      ai_status_color,
      timestamp,
      transcript_text,
      fields_populated,
      call_source,
      lead_id,
      leads (
        lead_id,
        full_name,
        phone_number,
        shape_lead_id,
        lead_source,
        reference_code,
        current_status_label,
        current_status_color
      )
    `,
    )
    .like('external_call_id', '%:transcript')
    .gte('timestamp', since);

  if (until) {
    transcriptQuery = transcriptQuery.lte('timestamp', until);
  }

  const { data: transcriptRows, error: transcriptError } = await transcriptQuery;

  if (transcriptError) {
    throw transcriptError;
  }

  for (const row of transcriptRows ?? []) {
    const callId = parseCallId(row.external_call_id);
    transcriptByCallId.set(callId, row);
  }

  let shapeQuery = supabase
    .from('transcripts')
    .select(
      `
      transcript_id,
      timestamp,
      external_call_id,
      call_source,
      fields_populated,
      ai_status_label,
      ai_status_color,
      leads (
        lead_id,
        full_name,
        phone_number,
        shape_lead_id,
        lead_source,
        reference_code,
        current_status_label,
        current_status_color
      )
    `,
    )
    .like('external_call_id', 'shape:%:created')
    .gte('timestamp', since)
    .order('timestamp', { ascending: false })
    .limit(maxRows);

  if (until) {
    shapeQuery = shapeQuery.lte('timestamp', until);
  }

  const { data: shapeCreatedRows, error: shapeError } = await shapeQuery;

  if (shapeError) {
    throw shapeError;
  }

  const calls = [];
  const listedCallIds = new Set();
  const stateFilter = state ? String(state).trim().toUpperCase() : null;

  for (const row of answeredRows ?? []) {
    const lead = normalizeLead(row);
    const meta = row.fields_populated ?? {};
    const callId = parseCallId(row.external_call_id);

    const channelKey = channelFromMeta(meta, lead, row.call_source);
    const landingState = meta.landing_page_state || meta.questmail_state || null;

    if (channel && channel !== channelKey) {
      continue;
    }
    if (stateFilter && landingState !== stateFilter) {
      continue;
    }

    calls.push(
      buildCallRecordResolved({
        callId,
        answeredAt: row.timestamp,
        meta,
        lead,
        callSource: row.call_source,
        transcriptRow: transcriptByCallId.get(callId),
      }),
    );
    listedCallIds.add(callId);
  }

  for (const [callId, transcriptRow] of transcriptByCallId) {
    if (listedCallIds.has(callId)) {
      continue;
    }

    const lead = normalizeLead(transcriptRow);
    if (!lead?.lead_id) {
      continue;
    }

    const meta = {
      call_channel: lead.lead_source === 'questmail' ? 'questmail' : 'inbound_zoom',
      shape_lead_id: lead.shape_lead_id ?? null,
      reference_code: lead.reference_code ?? null,
      backfilled_listing: true,
    };
    const channelKey = channelFromMeta(meta, lead, transcriptRow.call_source);
    const landingState = meta.landing_page_state || meta.questmail_state || null;

    if (channel && channel !== channelKey) {
      continue;
    }
    if (stateFilter && landingState !== stateFilter) {
      continue;
    }

    calls.push(
      buildCallRecordResolved({
        callId,
        answeredAt: transcriptRow.timestamp,
        meta,
        lead,
        callSource: transcriptRow.call_source,
        transcriptRow,
        missingAnsweredRow: true,
      }),
    );
    listedCallIds.add(callId);
  }

  for (const row of shapeCreatedRows ?? []) {
    const lead = normalizeLead(row);
    const meta = row.fields_populated ?? {};
    const callId = parseCallId(row.external_call_id);

    if (listedCallIds.has(callId)) {
      continue;
    }

    const channelKey = channelFromMeta(meta, lead, row.call_source);
    const landingState = meta.landing_page_state || meta.questmail_state || null;

    if (channel && channel !== channelKey) {
      continue;
    }
    if (stateFilter && landingState !== stateFilter) {
      continue;
    }

    calls.push(
      buildCallRecordResolved({
        callId,
        answeredAt: row.timestamp,
        meta,
        lead,
        callSource: row.call_source,
        transcriptRow: transcriptByCallId.get(callId) ?? null,
      }),
    );
    listedCallIds.add(callId);
  }

  calls.sort((a, b) => new Date(b.answered_at).getTime() - new Date(a.answered_at).getTime());

  return {
    calls: calls.slice(0, maxRows),
    count: Math.min(calls.length, maxRows),
    since,
    until,
    hours: sinceIso == null ? Number(hours) : null,
    view_label: resolveViewLabel(hours),
    generated_at: new Date().toISOString(),
    landing_states: ['FL', 'GA', 'NC', 'SC', 'TN', 'TX'],
  };
}
