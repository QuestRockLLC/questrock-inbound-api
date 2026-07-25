import { getTranscriptHistory } from '../transcripts.js';
import { redactTranscriptPii } from '../transcript-redact.js';
import { DEFAULT_MAILER_CALL_SCRIPT, renderCallScript } from './default-call-script.js';
import { buildMailerShapeNotes } from '../mailer/mailer-notes.js';
import { formatMailerDateEst } from '../mailer/mailer-dates.js';
import {
  formatMailerLeadForDisplay,
  formatMailerMoneyOrDash,
  formatMailerPercentOrDash,
} from '../mailer/display-format.js';

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 */
export async function getMailerLeadDetail(supabase, { referenceCode, mailerLeadId }) {
  let query = supabase.from('mailer_leads').select('*');

  if (mailerLeadId) {
    query = query.eq('mailer_lead_id', mailerLeadId);
  } else {
    query = query.eq('reference_code', String(referenceCode).trim().toUpperCase());
  }

  const { data: mailerLead, error } = await query.maybeSingle();

  if (error) {
    throw error;
  }

  if (!mailerLead) {
    return null;
  }

  const { data: batch } = await supabase
    .from('mailer_import_batches')
    .select('batch_label, created_at, batch_id')
    .eq('batch_id', mailerLead.import_batch_id)
    .maybeSingle();

  const [eventsResult, leadResult, transcripts] = await Promise.all([
    supabase
      .from('mailer_lo_events')
      .select('*')
      .eq('mailer_lead_id', mailerLead.mailer_lead_id)
      .order('created_at', { ascending: false })
      .limit(50),
    mailerLead.lead_id
      ? supabase.from('leads').select('*').eq('lead_id', mailerLead.lead_id).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    mailerLead.lead_id
      ? getTranscriptHistory(supabase, mailerLead.lead_id)
      : Promise.resolve([]),
  ]);

  if (eventsResult.error) {
    throw eventsResult.error;
  }

  const events = eventsResult.data ?? [];
  const lead = leadResult?.data ?? null;

  const history = buildHistoryTimeline({
    mailerLead,
    batch,
    events,
    transcripts,
    lead,
  });

  return {
    mailer_lead: mailerLead,
    batch,
    lead,
    events,
    transcripts,
    history,
  };
}

function buildHistoryTimeline({ mailerLead, batch, events, transcripts, lead }) {
  const items = [];

  items.push({
    at: mailerLead.imported_at,
    type: 'imported',
    title: 'Mailer list imported',
    detail: batch?.batch_label ? `Batch: ${batch.batch_label}` : 'Thursday mailer drop',
  });

  if (mailerLead.mail_date) {
    const mailEst = formatMailerDateEst(mailerLead.mail_date);
    items.push({
      at: mailerLead.imported_at,
      type: 'mail',
      title: 'Mail piece sent',
      detail: mailEst ? `Mail date (EST): ${mailEst}` : `Mail date: ${mailerLead.mail_date}`,
    });
  }

  for (const event of events) {
    items.push({
      at: event.created_at,
      type: event.event_type,
      title: eventTitle(event),
      detail: eventDetail(event),
      lo_name: event.lo_name,
    });
  }

  for (const transcript of transcripts) {
    const preview = redactTranscriptPii(String(transcript.transcript_text ?? '')).slice(0, 200);
    items.push({
      at: transcript.timestamp,
      type: 'call',
      title: transcript.call_source
        ? `Call — ${transcript.call_source}`
        : 'Call transcript',
      detail: preview || '(Call answered — transcript pending)',
      ai_status_label: transcript.ai_status_label,
    });
  }

  if (lead?.current_status_label) {
    items.push({
      at: lead.updated_at,
      type: 'status',
      title: 'Current pipeline status',
      detail: lead.current_status_label,
    });
  }

  return items.sort((a, b) => new Date(b.at) - new Date(a.at));
}

function eventTitle(event) {
  if (event.event_type === 'assigned') {
    return `Assigned to ${event.lo_name || 'LO'}`;
  }
  if (event.event_type === 'unassigned') {
    return 'Assignment cleared';
  }
  if (event.event_type === 'note') {
    return `Note — ${event.lo_name || 'LO'}`;
  }
  return event.event_type;
}

function eventDetail(event) {
  if (event.details?.note) {
    return event.details.note;
  }
  if (event.event_type === 'assigned' && event.details?.previous_lo) {
    return `Previously: ${event.details.previous_lo}`;
  }
  return '';
}

export function buildLeadScript(mailerLead, loName, template = DEFAULT_MAILER_CALL_SCRIPT) {
  const firstName = mailerLead.first_name || mailerLead.full_name?.split(/\s+/)[0] || 'there';
  const address = [mailerLead.address_line_1, mailerLead.address_line_2].filter(Boolean).join(', ');

  return renderCallScript(template || DEFAULT_MAILER_CALL_SCRIPT, {
    first_name: firstName,
    lo_name: loName || 'your loan officer',
    address: address || 'your property address',
    city: mailerLead.city || '',
    state: mailerLead.state || '',
    offer_code: mailerLead.reference_code,
    mtg_amount: formatMailerMoneyOrDash(mailerLead.mtg_amount),
    new_rate: formatMailerPercentOrDash(mailerLead.new_rate),
    new_payment: formatMailerMoneyOrDash(mailerLead.new_total_payment),
    follow_up_window: 'in a few months',
  });
}

export function buildLeadBrief(mailerLead) {
  const lines = [
    `You're speaking with **${mailerLead.full_name || 'the homeowner'}**.`,
    `Property: **${mailerLead.address_line_1 || '—'}**${mailerLead.address_line_2 ? `, ${mailerLead.address_line_2}` : ''}, **${mailerLead.city || '—'}, ${mailerLead.state || '—'} ${mailerLead.zip_code || ''}**.`,
    `Offer code on mailer: **${mailerLead.reference_code}**.`,
    `Loan amount: **${formatMailerMoneyOrDash(mailerLead.mtg_amount)}**.`,
    `Loan type: **${mailerLead.loan_type || '—'}**.`,
    `New rate: **${formatMailerPercentOrDash(mailerLead.new_rate)}**.`,
    `New principal & interest (letter): **${formatMailerMoneyOrDash(mailerLead.new_total_payment)}**.`,
  ];

  if (mailerLead.assigned_lo_name) {
    lines.push(`Assigned LO: **${mailerLead.assigned_lo_name}**.`);
  }

  return lines.join('\n\n');
}

export function buildLeadShapeNotesPreview(mailerLead) {
  return buildMailerShapeNotes(mailerLead);
}

export function buildLeadDetailForLoDesk(mailerLead) {
  return formatMailerLeadForDisplay(mailerLead);
}
