import { getSupabaseClient } from '../lib/supabase.js';
import { findLeadByShapeId } from '../lib/leads.js';
import { appendTranscript, getTranscriptHistory } from '../lib/transcripts.js';
import { assertAuthorized, normalizePayload, readJsonBody, sendJson } from '../lib/http.js';

function parseNotePayload(body) {
  const normalized = normalizePayload(body);

  if (!normalized.shapeLeadId) {
    const error = new Error('Missing required field: shape_lead_id');
    error.statusCode = 400;
    throw error;
  }

  const note = String(normalized.transcriptText ?? '').trim();

  if (!note) {
    const error = new Error('Missing required field: note');
    error.statusCode = 400;
    throw error;
  }

  const parsedTimestamp = new Date(normalized.timestamp ?? Date.now());

  if (Number.isNaN(parsedTimestamp.getTime())) {
    const error = new Error('timestamp must be a valid ISO date string.');
    error.statusCode = 400;
    throw error;
  }

  return {
    shapeLeadId: String(normalized.shapeLeadId).trim(),
    note,
    timestamp: parsedTimestamp.toISOString(),
    loName: normalized.loName ?? null,
  };
}

/**
 * Logs an LO note into the Supabase transcript chain.
 * Shape notes_sidebar update stays in Zapier for now.
 */
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return sendJson(res, 405, { error: 'Method Not Allowed' });
  }

  try {
    assertAuthorized(req);

    const body = readJsonBody(req);
    const payload = parseNotePayload(body);
    const supabase = getSupabaseClient();

    const lead = await findLeadByShapeId(supabase, payload.shapeLeadId);

    if (!lead) {
      const error = new Error(
        `No Supabase lead linked to shape_lead_id ${payload.shapeLeadId}.`,
      );
      error.statusCode = 404;
      throw error;
    }

    const noteText = payload.loName
      ? `[LO Note — ${payload.loName}]\n${payload.note}`
      : `[LO Note]\n${payload.note}`;

    const externalCallId = `lo-note:${payload.shapeLeadId}:${payload.timestamp}`;

    const { transcript, created } = await appendTranscript(supabase, {
      leadId: lead.lead_id,
      callSource: 'LO Note',
      transcriptText: noteText,
      timestamp: payload.timestamp,
      externalCallId,
      aiStatusLabel: lead.current_status_label,
      aiStatusColor: lead.current_status_color,
      fieldsPopulated: { notes_sidebar: payload.note },
    });

    const historyCount = (await getTranscriptHistory(supabase, lead.lead_id)).length;

    return sendJson(res, 200, {
      lead_id: lead.lead_id,
      transcript_id: transcript.transcript_id,
      shape_lead_id: payload.shapeLeadId,
      transcript_created: created,
      transcript_count: historyCount,
    });
  } catch (error) {
    console.error('[lo-note] failed:', error);

    const statusCode = error.statusCode ?? 500;
    const message =
      statusCode === 500 ? 'Internal Server Error' : error.message ?? 'Request failed';

    return sendJson(res, statusCode, { error: message });
  }
}
