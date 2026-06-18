import { getZoomAccessToken } from './auth.js';
import { fetchZoomTranscriptFromRecording, parseTranscriptPayload } from './fetch-transcript.js';

const ZOOM_API = 'https://api.zoom.us/v2';

async function zoomApiGet(path, { prefer = 'recording' } = {}) {
  const auth = await getZoomAccessToken({ prefer });
  if (auth.error) {
    return { ok: false, reason: 'zoom_auth', error: auth.error };
  }

  const response = await fetch(`${ZOOM_API}${path}`, {
    headers: { Authorization: `Bearer ${auth.accessToken}` },
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
    };
  }

  return { ok: true, data };
}

async function downloadTranscriptByRecordingId(recordingId) {
  const auth = await getZoomAccessToken({ prefer: 'recording' });
  if (auth.error) {
    return { ok: false, reason: 'zoom_auth', error: auth.error };
  }

  const response = await fetch(
    `${ZOOM_API}/phone/recording_transcript/download/${encodeURIComponent(recordingId)}`,
    { headers: { Authorization: `Bearer ${auth.accessToken}` } },
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
    recordings.find((row) => row.id || row.recording_id) ??
    recordings[0] ??
    null
  );
}

/**
 * Pull phone recording + transcript text from Zoom when the webhook was missed.
 */
export async function fetchTranscriptForCallId(callId) {
  const id = String(callId ?? '').trim();
  if (!id) {
    return { ok: false, reason: 'missing_call_id', message: 'call_id is required' };
  }

  const recordingsRes = await zoomApiGet(`/phone/call_logs/${encodeURIComponent(id)}/recordings`);
  if (!recordingsRes.ok) {
    return recordingsRes;
  }

  const recordings = normalizeRecordingsList(recordingsRes.data);
  if (!recordings.length) {
    return {
      ok: false,
      reason: 'no_recordings',
      message: 'Zoom has no recording for this call yet. Try again in a few minutes.',
    };
  }

  const recording = pickRecording(recordings);
  let fetched = await fetchZoomTranscriptFromRecording(recording);
  let zoomSource = 'transcript_download_url';

  if (!fetched.ok && fetched.reason === 'transcript_not_ready') {
    const recordingId = recording.id ?? recording.recording_id ?? recording.recordingId;
    if (recordingId) {
      fetched = await downloadTranscriptByRecordingId(recordingId);
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
    callerPhone:
      recording.caller_number ??
      recording.callerNumber ??
      recordingsRes.data?.caller_number ??
      null,
    calleePhone: recording.callee_number ?? recording.calleeNumber ?? null,
    timestamp:
      recording.date_time ??
      recording.dateTime ??
      recording.recording_start ??
      new Date().toISOString(),
    zoom_source: zoomSource,
  };
}
