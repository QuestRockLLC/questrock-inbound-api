import { waitUntil } from '@vercel/functions';
import { getSupabaseClient } from '../lib/supabase.js';
import { findLeadByShapeId } from '../lib/leads.js';
import { appendTranscript, getTranscriptHistory } from '../lib/transcripts.js';
import {
  processTranscriptPipeline,
  runBackgroundTranscriptJob,
} from '../lib/process-transcript-pipeline.js';
import { assertAuthorized, normalizePayload, readJsonBody, sendJson } from '../lib/http.js';
import { resolveLeadPhone } from '../lib/zoom-payload.js';

function parseTranscriptPayload(body) {
  const normalized = normalizePayload(body);

  if (!normalized.shapeLeadId) {
    const error = new Error('Missing required field: shape_lead_id');
    error.statusCode = 400;
    throw error;
  }

  if (!normalized.callId) {
    const error = new Error('Missing required field: call_id');
    error.statusCode = 400;
    throw error;
  }

  const transcriptText = String(normalized.transcriptText ?? '').trim();

  if (!transcriptText) {
    const error = new Error('Missing required field: transcript_text');
    error.statusCode = 400;
    throw error;
  }

  const parsedTimestamp = new Date(normalized.timestamp ?? Date.now());

  if (Number.isNaN(parsedTimestamp.getTime())) {
    const error = new Error('timestamp must be a valid ISO date string.');
    error.statusCode = 400;
    throw error;
  }

  const direction = String(normalized.direction ?? 'inbound').trim().toLowerCase();
  const { formattedPhone } = resolveLeadPhone(normalized);

  const asyncMode = body.async !== false && body.async !== 'false';

  return {
    shapeLeadId: String(normalized.shapeLeadId).trim(),
    callId: String(normalized.callId).trim(),
    transcriptText,
    timestamp: parsedTimestamp.toISOString(),
    loName: normalized.loName ?? null,
    formattedPhone,
    fullName: normalized.fullName ?? null,
    asyncMode,
  };
}

/**
 * Saves transcript row quickly for async mode (deduped by external_call_id).
 */
async function ingestTranscriptOnly(payload) {
  const supabase = getSupabaseClient();
  const lead = await findLeadByShapeId(supabase, payload.shapeLeadId);

  if (!lead) {
    const error = new Error(
      `No Supabase lead linked to shape_lead_id ${payload.shapeLeadId}. Run /api/call-answered first.`,
    );
    error.statusCode = 404;
    throw error;
  }

  const { transcript, created } = await appendTranscript(supabase, {
    leadId: lead.lead_id,
    callSource: 'Zoom Phone',
    transcriptText: payload.transcriptText,
    timestamp: payload.timestamp,
    externalCallId: `${payload.callId}:transcript`,
    aiStatusLabel: lead.current_status_label,
    aiStatusColor: lead.current_status_color,
  });

  return { lead, transcript, created };
}

/**
 * Zoom transcript webhook handler.
 * Default async=true returns in ~2s; AI + Shape + notify run in background (avoids Zapier 30s timeout).
 */
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return sendJson(res, 405, { error: 'Method Not Allowed' });
  }

  try {
    assertAuthorized(req);

    const body = readJsonBody(req);
    const payload = parseTranscriptPayload(body);

    if (payload.asyncMode) {
      const { lead, transcript, created } = await ingestTranscriptOnly(payload);

      waitUntil(
        runBackgroundTranscriptJob(payload).catch((error) => {
          console.error('[zoom-transcript] waitUntil failed:', error);
        }),
      );

      return sendJson(res, 202, {
        accepted: true,
        async: true,
        message:
          'Transcript queued for AI processing. Admin email fires via ZAPIER_ADMIN_NOTIFY_WEBHOOK_URL when complete.',
        lead_id: lead.lead_id,
        transcript_id: transcript.transcript_id,
        shape_lead_id: payload.shapeLeadId,
        transcript_created: created,
      });
    }

    const result = await processTranscriptPipeline(payload);
    return sendJson(res, 200, result);
  } catch (error) {
    console.error('[zoom-transcript] failed:', error);

    const statusCode = error.statusCode ?? 500;
    const message =
      statusCode === 500 ? 'Internal Server Error' : error.message ?? 'Request failed';

    return sendJson(res, statusCode, { error: message });
  }
}

export const config = {
  maxDuration: 300,
};
