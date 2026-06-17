import { getZoomAccessToken } from './auth.js';

function formatTimelineTranscript(timeline) {
  if (!Array.isArray(timeline) || !timeline.length) {
    return '';
  }

  const lines = ['📞 CALL TRANSCRIPT', '='.repeat(50), ''];

  for (const entry of timeline) {
    const ts = entry.ts ?? entry.timestamp ?? '00:00:00';
    const user = entry.users?.[0]?.username ?? entry.user ?? entry.speaker ?? 'Speaker';
    const text = String(entry.text ?? entry.content ?? '').trim();
    if (!text) continue;
    lines.push(`[${ts}] ${user}:`);
    lines.push(`"${text}"`);
    lines.push('');
  }

  lines.push('='.repeat(50));
  return lines.join('\n');
}

function parseTranscriptPayload(rawText) {
  if (!rawText?.trim()) {
    return '';
  }

  try {
    const json = JSON.parse(rawText);
    if (Array.isArray(json.timeline)) {
      return formatTimelineTranscript(json.timeline);
    }
    if (typeof json.transcript === 'string') {
      return json.transcript;
    }
    if (typeof json.text === 'string') {
      return json.text;
    }
  } catch {
    // plain text transcript file
  }

  return rawText.trim();
}

/**
 * Downloads transcript from Zoom Phone recording metadata.
 * Webhook only provides transcript_download_url — not the text itself.
 */
export async function fetchZoomTranscriptFromRecording(recording) {
  const downloadUrl = recording?.transcript_download_url ?? recording?.transcriptDownloadUrl;
  if (!downloadUrl) {
    return {
      ok: false,
      reason: 'transcript_not_ready',
      message: 'No transcript_download_url on recording — Zoom may still be processing (~7 min after call).',
    };
  }

  const auth = await getZoomAccessToken();
  if (auth.error) {
    return { ok: false, reason: 'zoom_auth', error: auth.error };
  }

  const response = await fetch(downloadUrl, {
    headers: {
      Authorization: `Bearer ${auth.accessToken}`,
    },
  });

  const rawText = await response.text();
  if (!response.ok) {
    return {
      ok: false,
      reason: 'download_failed',
      http_status: response.status,
      error: rawText.slice(0, 300),
    };
  }

  const transcriptText = parseTranscriptPayload(rawText);
  if (!transcriptText || transcriptText.length < 20) {
    return {
      ok: false,
      reason: 'empty_transcript',
      message: 'Downloaded transcript file was empty or unparseable.',
    };
  }

  return {
    ok: true,
    transcriptText,
    callId: String(recording.call_id ?? recording.callId ?? ''),
    callerName: recording.caller_name ?? recording.callerName ?? null,
    callerPhone: recording.caller_number ?? recording.callerNumber ?? null,
    calleePhone: recording.callee_number ?? recording.calleeNumber ?? null,
    direction: String(recording.direction ?? 'inbound').toLowerCase(),
    timestamp: recording.date_time ?? recording.dateTime ?? new Date().toISOString(),
    duration: recording.duration ?? null,
  };
}
