function parseCallId(externalCallId) {
  const raw = String(externalCallId ?? '');
  if (raw.endsWith(':answered')) {
    return raw.slice(0, -':answered'.length);
  }
  if (raw.endsWith(':transcript')) {
    return raw.slice(0, -':transcript'.length);
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

function channelFromRow(answeredRow, lead) {
  const meta = answeredRow?.fields_populated ?? {};
  if (meta.call_channel) {
    return meta.call_channel;
  }
  if (lead?.lead_source === 'questmail' || answeredRow?.call_source === 'QuestMail') {
    return 'questmail';
  }
  return 'inbound_zoom';
}

function formatChannel(channel, meta) {
  if (channel === 'questmail') {
    const state = meta?.questmail_state ? ` · ${meta.questmail_state}` : '';
    return { key: 'questmail', label: `QuestMail${state}` };
  }
  return { key: 'inbound_zoom', label: 'Inbound Ads' };
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 */
export async function listInboundCalls(supabase, { limit = 80, channel, hours = 168 } = {}) {
  const since = new Date(Date.now() - Number(hours) * 60 * 60 * 1000).toISOString();

  const { data: answeredRows, error } = await supabase
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
    .limit(Math.min(limit, 200));

  if (error) {
    throw error;
  }

  const transcriptByCallId = new Map();
  const { data: transcriptRows } = await supabase
    .from('transcripts')
    .select('external_call_id, ai_status_label, ai_status_color, timestamp, transcript_text')
    .like('external_call_id', '%:transcript')
    .gte('timestamp', since);

  for (const row of transcriptRows ?? []) {
    const callId = parseCallId(row.external_call_id);
    transcriptByCallId.set(callId, row);
  }

  const calls = [];

  for (const row of answeredRows ?? []) {
    const lead = Array.isArray(row.leads) ? row.leads[0] : row.leads ?? {};
    const meta = row.fields_populated ?? {};
    const callId = parseCallId(row.external_call_id);
    const channelKey = channelFromRow(row, lead);
    const channelInfo = formatChannel(channelKey, meta);

    if (channel && channel !== channelKey) {
      continue;
    }

    const transcriptRow = transcriptByCallId.get(callId);
    const aiStatus = transcriptRow?.ai_status_label || lead.current_status_label || null;
    const aiColor = transcriptRow?.ai_status_color || lead.current_status_color || null;
    const transcriptState = transcriptRow?.transcript_text?.trim()
      ? 'ready'
      : transcriptRow
        ? 'processing'
        : 'pending';

    calls.push({
      call_id: callId,
      answered_at: row.timestamp,
      call_channel: channelKey,
      channel_label: channelInfo.label,
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
      ai_status_label: aiStatus,
      ai_status_color: aiColor,
      transcript_state: transcriptState,
      transcript_at: transcriptRow?.timestamp ?? null,
    });
  }

  return {
    calls,
    count: calls.length,
    since,
    generated_at: new Date().toISOString(),
  };
}
