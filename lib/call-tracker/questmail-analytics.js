/**
 * Deep read-only analytics for QuestMail pipeline data in Supabase.
 */

function parseCallId(externalCallId) {
  const raw = String(externalCallId ?? '');
  for (const suffix of [':answered', ':transcript', ':created']) {
    if (raw.endsWith(suffix)) {
      return raw.slice(0, -suffix.length);
    }
  }
  return raw;
}

function isQuestMailRow(row) {
  const meta = row.fields_populated ?? {};
  const lead = Array.isArray(row.leads) ? row.leads[0] : row.leads;
  return (
    meta.call_channel === 'questmail' ||
    lead?.lead_source === 'questmail' ||
    row.call_source === 'QuestMail' ||
    Boolean(meta.questmail_toll || meta.questmail_hold || meta.questmail_label)
  );
}

function phone10(value) {
  const d = String(value ?? '').replace(/\D/g, '');
  if (d.length === 11 && d.startsWith('1')) {
    return d.slice(1);
  }
  return d.length >= 10 ? d.slice(-10) : d;
}

const TOLL_FREE = new Set(['800', '833', '844', '855', '866', '877', '888']);

async function fetchAll(supabase, table, select, pageSize = 1000) {
  const rows = [];
  let from = 0;

  while (true) {
    const { data, error } = await supabase.from(table).select(select).range(from, from + pageSize - 1);
    if (error) {
      throw error;
    }
    if (!data?.length) {
      break;
    }
    rows.push(...data);
    if (data.length < pageSize) {
      break;
    }
    from += pageSize;
  }

  return rows;
}

export async function analyzeQuestMailRecords(supabase) {
  const [allTranscripts, allLeads, mailerLeads] = await Promise.all([
    fetchAll(
      supabase,
      'transcripts',
      `
      transcript_id,
      lead_id,
      call_source,
      external_call_id,
      transcript_text,
      timestamp,
      fields_populated,
      ai_status_label,
      leads (
        lead_id,
        full_name,
        phone_number,
        shape_lead_id,
        lead_source,
        reference_code,
        created_at
      )
    `,
    ),
    fetchAll(
      supabase,
      'leads',
      'lead_id, full_name, phone_number, shape_lead_id, lead_source, reference_code, created_at',
    ),
    fetchAll(
      supabase,
      'mailer_leads',
      'mailer_lead_id, reference_code, full_name, phone, shape_lead_id, lead_id, imported_at',
    ),
  ]);

  const questmailTranscripts = allTranscripts.filter(isQuestMailRow);
  const questmailLeads = allLeads.filter((l) => l.lead_source === 'questmail');

  const byExternalId = new Map();
  const duplicateExternalIds = [];
  for (const row of questmailTranscripts) {
    const key = row.external_call_id || row.transcript_id;
    if (!byExternalId.has(key)) {
      byExternalId.set(key, []);
    }
    byExternalId.get(key).push(row);
  }
  for (const [key, rows] of byExternalId) {
    if (rows.length > 1) {
      duplicateExternalIds.push({
        external_call_id: key,
        count: rows.length,
        transcript_ids: rows.map((r) => r.transcript_id),
      });
    }
  }

  const byCallId = new Map();
  for (const row of questmailTranscripts) {
    const callId = parseCallId(row.external_call_id);
    if (!byCallId.has(callId)) {
      byCallId.set(callId, { answered: null, transcript: null, created: null, other: [] });
    }
    const bucket = byCallId.get(callId);
    const ext = String(row.external_call_id ?? '');
    if (ext.endsWith(':answered')) {
      bucket.answered = row;
    } else if (ext.endsWith(':transcript')) {
      bucket.transcript = row;
    } else if (ext.endsWith(':created')) {
      bucket.created = row;
    } else {
      bucket.other.push(row);
    }
  }

  const callSummaries = [...byCallId.entries()].map(([call_id, bucket]) => {
    const lead =
      bucket.answered?.leads?.[0] ??
      bucket.answered?.leads ??
      bucket.transcript?.leads?.[0] ??
      bucket.transcript?.leads ??
      null;
    return {
      call_id,
      has_answered: Boolean(bucket.answered),
      has_transcript_row: Boolean(bucket.transcript),
      has_transcript_text: Boolean(bucket.transcript?.transcript_text?.trim()),
      lead_id: bucket.answered?.lead_id ?? bucket.transcript?.lead_id ?? null,
      shape_lead_id: lead?.shape_lead_id ?? null,
      lead_name: lead?.full_name ?? null,
      answered_at: bucket.answered?.timestamp ?? bucket.transcript?.timestamp ?? null,
    };
  });

  const uniqueCalls = byCallId.size;
  const withTranscriptText = callSummaries.filter((c) => c.has_transcript_text).length;
  const answeredOnly = callSummaries.filter((c) => c.has_answered && !c.has_transcript_text).length;
  const transcriptOnly = callSummaries.filter((c) => !c.has_answered && c.has_transcript_row).length;

  const shapeLeadUsage = new Map();
  for (const call of callSummaries) {
    if (!call.shape_lead_id) {
      continue;
    }
    if (!shapeLeadUsage.has(call.shape_lead_id)) {
      shapeLeadUsage.set(call.shape_lead_id, []);
    }
    shapeLeadUsage.get(call.shape_lead_id).push(call.call_id);
  }

  const sharedShapeLeads = [...shapeLeadUsage.entries()]
    .filter(([, callIds]) => callIds.length > 1)
    .map(([shape_lead_id, call_ids]) => ({ shape_lead_id, call_count: call_ids.length, call_ids }))
    .sort((a, b) => b.call_count - a.call_count);

  const leadIdUsage = new Map();
  for (const call of callSummaries) {
    if (!call.lead_id) {
      continue;
    }
    if (!leadIdUsage.has(call.lead_id)) {
      leadIdUsage.set(call.lead_id, { call_ids: [], name: call.lead_name });
    }
    const entry = leadIdUsage.get(call.lead_id);
    entry.call_ids.push(call.call_id);
    entry.name = call.lead_name ?? entry.name;
  }

  const sharedLeadIds = [...leadIdUsage.entries()]
    .filter(([, v]) => v.call_ids.length > 1)
    .map(([lead_id, v]) => ({
      lead_id,
      full_name: v.name,
      call_count: v.call_ids.length,
      call_ids: v.call_ids,
    }))
    .sort((a, b) => b.call_count - a.call_count);

  const tollFreeLeads = questmailLeads.filter((l) => TOLL_FREE.has(phone10(l.phone_number).slice(0, 3)));

  const timestamps = questmailTranscripts
    .map((r) => r.timestamp)
    .filter(Boolean)
    .sort();

  const mailerLinked = mailerLeads.filter((m) => m.lead_id || m.shape_lead_id);

  return {
    generated_at: new Date().toISOString(),
    totals: {
      questmail_leads_in_supabase: questmailLeads.length,
      questmail_transcript_rows: questmailTranscripts.length,
      unique_inbound_calls: uniqueCalls,
      calls_with_transcript_text: withTranscriptText,
      calls_answered_awaiting_transcript: answeredOnly,
      calls_transcript_without_answered_row: transcriptOnly,
      mailer_leads_imported: mailerLeads.length,
      mailer_leads_linked_to_calls: mailerLinked.length,
      duplicate_external_call_id_groups: duplicateExternalIds.length,
      shared_shape_lead_id_groups: sharedShapeLeads.length,
      shared_lead_id_groups: sharedLeadIds.length,
      toll_free_phone_lead_records: tollFreeLeads.length,
    },
    date_range: {
      first_event: timestamps[0] ?? null,
      last_event: timestamps[timestamps.length - 1] ?? null,
    },
    row_breakdown: {
      answered_rows: questmailTranscripts.filter((r) => String(r.external_call_id).endsWith(':answered')).length,
      transcript_rows: questmailTranscripts.filter((r) => String(r.external_call_id).endsWith(':transcript')).length,
      created_rows: questmailTranscripts.filter((r) => String(r.external_call_id).endsWith(':created')).length,
    },
    duplicate_external_call_ids: duplicateExternalIds,
    shared_shape_lead_ids: sharedShapeLeads,
    shared_lead_ids_across_calls: sharedLeadIds,
    calls: callSummaries.sort((a, b) => new Date(b.answered_at).getTime() - new Date(a.answered_at).getTime()),
  };
}
