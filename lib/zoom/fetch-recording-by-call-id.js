import { getZoomAccessToken } from './auth.js';
import { fetchZoomTranscriptFromRecording, parseTranscriptPayload } from './fetch-transcript.js';

const ZOOM_API = 'https://api.zoom.us/v2';
const CREDENTIAL_PREFERS = ['recording', 'transcript', 'default', 'call'];

async function zoomApiGet(path, { prefer = 'recording' } = {}) {
  const auth = await getZoomAccessToken({ prefer });
  if (auth.error) {
    return { ok: false, reason: 'zoom_auth', error: auth.error, prefer };
  }

  const response = await fetch(`${ZOOM_API}${path}`, {
    headers: { Authorization: `Bearer ${auth.accessToken}` },
    redirect: 'follow',
  });

  const text = await response.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }

  if (!response.ok) {
    return {
      ok: false,
      reason: 'zoom_api',
      http_status: response.status,
      error: data.message || data.error || text.slice(0, 300),
      prefer,
    };
  }

  return { ok: true, data, prefer };
}

async function zoomApiGetWithFallback(path) {
  let last = null;
  for (const prefer of CREDENTIAL_PREFERS) {
    const result = await zoomApiGet(path, { prefer });
    if (result.ok) {
      return result;
    }
    last = result;
    if (result.reason !== 'zoom_auth' && result.http_status !== 401) {
      break;
    }
  }
  return last ?? { ok: false, reason: 'zoom_api', error: 'Zoom API request failed' };
}

async function downloadTranscriptByRecordingId(recordingId, { prefer = 'recording' } = {}) {
  const auth = await getZoomAccessToken({ prefer });
  if (auth.error) {
    return { ok: false, reason: 'zoom_auth', error: auth.error };
  }

  const response = await fetch(
    `${ZOOM_API}/phone/recording_transcript/download/${encodeURIComponent(recordingId)}`,
    {
      headers: { Authorization: `Bearer ${auth.accessToken}` },
      redirect: 'follow',
    },
  );

  const rawText = await response.text();
  if (!response.ok) {
    return {
      ok: false,
      reason: 'transcript_download_failed',
      http_status: response.status,
      error: rawText.slice(0, 300),
    };
  }

  const transcriptText = parseTranscriptPayload(rawText);
  if (!transcriptText || transcriptText.length < 20) {
    return {
      ok: false,
      reason: 'empty_transcript',
      message: 'Zoom returned an empty transcript file.',
    };
  }

  return { ok: true, transcriptText };
}

function normalizeRecordingsList(payload) {
  const raw = payload?.recordings ?? payload?.recording ?? payload;
  if (Array.isArray(raw)) return raw.filter(Boolean);
  if (raw && typeof raw === 'object') return [raw];
  return [];
}

function pickRecording(recordings) {
  return (
    recordings.find((row) => row.transcript_download_url || row.transcriptDownloadUrl) ??
    recordings.find((row) => row.id || row.recording_id || row.recordingId) ??
    recordings[0] ??
    null
  );
}

function recordingIdsFromCallLogDetails(data) {
  const ids = new Set();
  for (const row of data?.log_details ?? []) {
    const id = row.recording_id ?? row.recordingId;
    if (id) ids.add(String(id));
  }
  for (const row of normalizeRecordingsList(data)) {
    const id = row.id ?? row.recording_id ?? row.recordingId;
    if (id) ids.add(String(id));
  }
  return [...ids];
}

async function fetchTranscriptFromRecordingObject(recording, prefer) {
  let fetched = await fetchZoomTranscriptFromRecording(recording, { prefer });
  let zoomSource = 'transcript_download_url';

  if (!fetched.ok && fetched.reason === 'transcript_not_ready') {
    const recordingId = recording.id ?? recording.recording_id ?? recording.recordingId;
    if (recordingId) {
      fetched = await downloadTranscriptByRecordingId(recordingId, { prefer });
      zoomSource = 'recording_id_download';
    }
  }

  if (!fetched.ok) {
    return fetched;
  }

  return {
    ok: true,
    transcriptText: fetched.transcriptText,
    recording,
    zoom_source: zoomSource,
    callerPhone: recording.caller_number ?? recording.callerNumber ?? null,
    calleePhone: recording.callee_number ?? recording.calleeNumber ?? null,
    timestamp:
      recording.date_time ??
      recording.dateTime ??
      recording.recording_start ??
      new Date().toISOString(),
  };
}

/**
 * Pull phone recording + transcript text from Zoom when the webhook was missed.
 */
export async function fetchTranscriptForCallId(callId) {
  const id = String(callId ?? '').trim();
  if (!id) {
    return { ok: false, reason: 'missing_call_id', message: 'call_id is required' };
  }

  const attempts = [];

  const recordingsRes = await zoomApiGetWithFallback(`/phone/call_logs/${encodeURIComponent(id)}/recordings`);
  attempts.push({ step: 'call_logs_recordings', ...recordingsRes });

  if (recordingsRes.ok) {
    const recordings = normalizeRecordingsList(recordingsRes.data);
    if (recordings.length) {
      const recording = pickRecording(recordings);
      const fetched = await fetchTranscriptFromRecordingObject(recording, recordingsRes.prefer);
      if (fetched.ok) {
        return {
          ...fetched,
          callerPhone:
            fetched.callerPhone ??
            recordingsRes.data?.caller_number ??
            recordingsRes.data?.callerNumber ??
            null,
        };
      }
      attempts.push({ step: 'recordings_list_download', ...fetched });
    }
  }

  const callLogRes = await zoomApiGetWithFallback(`/phone/call_logs/${encodeURIComponent(id)}`);
  attempts.push({ step: 'call_log_details', ...callLogRes });

  if (callLogRes.ok) {
    const recordingIds = recordingIdsFromCallLogDetails(callLogRes.data);
    for (const recordingId of recordingIds) {
      const fetched = await downloadTranscriptByRecordingId(recordingId, { prefer: callLogRes.prefer });
      attempts.push({ step: `recording_transcript_download:${recordingId}`, ...fetched });
      if (fetched.ok) {
        return {
          ok: true,
          transcriptText: fetched.transcriptText,
          recording: { recording_id: recordingId },
          callerPhone: callLogRes.data?.caller_number ?? callLogRes.data?.callerNumber ?? null,
          calleePhone: callLogRes.data?.callee_number ?? callLogRes.data?.calleeNumber ?? null,
          timestamp: callLogRes.data?.date_time ?? new Date().toISOString(),
          zoom_source: 'call_log_recording_id',
        };
      }
    }
  }

  const historyRes = await zoomApiGetWithFallback(`/phone/call_history/${encodeURIComponent(id)}`);
  attempts.push({ step: 'call_history', ...historyRes });

  if (historyRes.ok) {
    const recordingIds = recordingIdsFromCallLogDetails(historyRes.data);
    for (const recordingId of recordingIds) {
      const fetched = await downloadTranscriptByRecordingId(recordingId, { prefer: historyRes.prefer });
      attempts.push({ step: `history_recording_transcript:${recordingId}`, ...fetched });
      if (fetched.ok) {
        return {
          ok: true,
          transcriptText: fetched.transcriptText,
          recording: { recording_id: recordingId },
          callerPhone: historyRes.data?.caller_number ?? historyRes.data?.callerNumber ?? null,
          calleePhone: historyRes.data?.callee_number ?? historyRes.data?.calleeNumber ?? null,
          timestamp: historyRes.data?.date_time ?? new Date().toISOString(),
          zoom_source: 'call_history_recording_id',
        };
      }
    }
  }

  const last = attempts[attempts.length - 1];
  if (last?.reason === 'zoom_auth') {
    return {
      ok: false,
      reason: 'zoom_auth',
      error: last.error,
      message: 'Zoom API credentials failed. Check ZOOM_ACCOUNT_ID and OAuth app secrets.',
      attempts,
    };
  }

  if (last?.http_status === 404 || recordingsRes.http_status === 404) {
    return {
      ok: false,
      reason: 'no_recordings',
      message:
        'Zoom has no recording/transcript for this call ID yet. Confirm the call_id matches Zoom Phone and try again in a few minutes.',
      attempts,
    };
  }

  return {
    ok: false,
    reason: last?.reason ?? 'transcript_not_ready',
    message:
      last?.message ||
      last?.error ||
      'Could not download transcript from Zoom. The recording may still be processing.',
    attempts,
  };
}
