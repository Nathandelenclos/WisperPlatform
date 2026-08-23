import { requestJson, requestNoContent } from './http';

/** Whisper models served by the platform (domain contract). */
export const WHISPER_MODELS = ['tiny', 'base', 'small', 'medium', 'large', 'turbo'] as const;
export type WhisperModel = (typeof WHISPER_MODELS)[number];

export const DEFAULT_MODEL: WhisperModel = 'medium';
export const DEFAULT_LANGUAGE: TranscriptionLanguage = 'French';

/**
 * Spoken languages offered. The value goes to the worker as a process argument: the domain
 * only accepts `/^[A-Za-z]{2,32}$/`, and a closed list guarantees that constraint. The name
 * shown to the reader lives in the message catalogue, keyed by this value.
 */
export const TRANSCRIPTION_LANGUAGES = [
  'French',
  'English',
  'Spanish',
  'German',
  'Italian',
  'Portuguese',
  'Dutch',
  'Russian',
  'Arabic',
  'Japanese',
  'Chinese',
  'Korean',
] as const;
export type TranscriptionLanguage = (typeof TRANSCRIPTION_LANGUAGES)[number];

/** Mirrors `MEDIA_MAX_BYTES` on the API side (2 GiB). The server remains the only judge. */
export const MEDIA_MAX_BYTES = 2_147_483_648;

export type TranscriptionStatus = 'pending' | 'transcribing' | 'completed' | 'failed';

/**
 * Where the computing happens: on the platform workers (`service`) or on the owner's own
 * machines (`owner`). No crossover on the API side — a request placed on `owner` waits for a
 * machine of its owner, for as long as it takes.
 */
export type Placement = 'service' | 'owner';

export const DEFAULT_PLACEMENT: Placement = 'service';

export type Segment = {
  ordinal: number;
  startMs: number;
  endMs: number;
  text: string;
  corrected: boolean;
  /** Speaker assigned by diarisation; `null` when no turn covers the segment. */
  speakerIndex: number | null;
};

/**
 * Speaker discovered by diarisation. The index is technical (produced by the clustering);
 * `name` is the one the owner gave, `null` as long as nobody has renamed anything.
 */
export type Speaker = {
  index: number;
  name: string | null;
};

/** List view. Dates serialised as ISO 8601 by the API. */
export type TranscriptionSummary = {
  id: string;
  status: TranscriptionStatus;
  model: WhisperModel;
  language: string;
  mediaName: string;
  mediaByteSize: number;
  segmentCount: number;
  durationMs: number;
  requestedAt: string;
  completedAt: string | null;
  failureReason: string | null;
  placement: Placement;
};

/** Detail view, segments included. */
export type TranscriptionView = {
  id: string;
  status: TranscriptionStatus;
  model: WhisperModel;
  language: string;
  mediaName: string;
  mediaContentType: string;
  mediaByteSize: number;
  requestedAt: string;
  completedAt: string | null;
  failureReason: string | null;
  placement: Placement;
  segments: Segment[];
  /** Speakers discovered. Empty when no diarisation took place. */
  speakers: Speaker[];
};

export const SUBTITLE_FORMATS = ['srt', 'vtt', 'txt'] as const;
export type SubtitleFormat = (typeof SUBTITLE_FORMATS)[number];

/**
 * Domain events received on the SSE stream. A single discriminating field: `name`.
 */
export type TranscriptionEvent =
  | { name: 'transcription.requested'; transcriptionId: string; occurredAt: string }
  | { name: 'transcription.started'; transcriptionId: string; occurredAt: string }
  | {
      name: 'transcription.segments-appended';
      transcriptionId: string;
      occurredAt: string;
      segments: Segment[];
    }
  | { name: 'transcription.completed'; transcriptionId: string; occurredAt: string }
  | { name: 'transcription.failed'; transcriptionId: string; occurredAt: string; reason: string }
  | { name: 'transcription.requeued'; transcriptionId: string; occurredAt: string }
  | {
      name: 'transcription.segment-corrected';
      transcriptionId: string;
      occurredAt: string;
      ordinal: number;
    }
  | {
      name: 'transcription.speakers-assigned';
      transcriptionId: string;
      occurredAt: string;
      speakers: Speaker[];
      /** Every segment, `speakerIndex` up to date: the pass recomputes the assignment. */
      segments: Segment[];
    }
  | {
      name: 'transcription.speaker-renamed';
      transcriptionId: string;
      occurredAt: string;
      index: number;
      /** `speakerName`, not `name`: that one already carries the name of the event. */
      speakerName: string;
    };

/** URLs served straight to the browser (media player, export links, SSE stream). */
export const transcriptionUrls = {
  media: (id: string): string => `/api/transcriptions/${encodeURIComponent(id)}/media`,
  export: (id: string, format: SubtitleFormat): string =>
    `/api/transcriptions/${encodeURIComponent(id)}/export?format=${format}`,
  events: (id: string): string => `/api/transcriptions/${encodeURIComponent(id)}/events`,
};

/**
 * Ceiling for sending a media file: `MEDIA_MAX_BYTES` at ~1 MB/s. Generous, but bounded — an
 * interrupted transfer must not leave the request hanging forever.
 */
const UPLOAD_TIMEOUT_MS = 40 * 60_000;

/** Uploads a media file and requests its transcription. */
export async function requestTranscription(p: {
  file: File;
  model: WhisperModel;
  language: string;
  placement: Placement;
}): Promise<{ id: string }> {
  const form = new FormData();
  form.append('file', p.file);
  form.append('model', p.model);
  form.append('language', p.language);
  form.append('placement', p.placement);
  return requestJson<{ id: string }>('/api/transcriptions', {
    method: 'POST',
    body: form,
    timeoutMs: UPLOAD_TIMEOUT_MS,
  });
}

/**
 * Transcriptions of the signed-in user, most recent first. The signal comes from React Query:
 * a request that became useless is aborted instead of running to the end.
 */
export async function listTranscriptions(p: { signal?: AbortSignal } = {}): Promise<
  TranscriptionSummary[]
> {
  return requestJson<TranscriptionSummary[]>('/api/transcriptions', { signal: p.signal });
}

export async function getTranscription(
  id: string,
  p: { signal?: AbortSignal } = {},
): Promise<TranscriptionView> {
  return requestJson<TranscriptionView>(`/api/transcriptions/${encodeURIComponent(id)}`, {
    signal: p.signal,
  });
}

/** Corrects the text of an already transcribed segment. */
export async function correctSegment(p: {
  transcriptionId: string;
  ordinal: number;
  text: string;
}): Promise<void> {
  await requestNoContent(
    `/api/transcriptions/${encodeURIComponent(p.transcriptionId)}/segments/${p.ordinal}`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: p.text }),
    },
  );
}

/**
 * Renames a speaker across the whole transcription. The API answers with the complete detail
 * view: that view is authoritative, the client has nothing to recompose.
 */
export async function renameSpeaker(p: {
  transcriptionId: string;
  index: number;
  name: string;
}): Promise<TranscriptionView> {
  return requestJson<TranscriptionView>(
    `/api/transcriptions/${encodeURIComponent(p.transcriptionId)}/speakers/${p.index}`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: p.name }),
    },
  );
}

/**
 * Moves a transcription that has not started. As with renaming, the API answers with the
 * complete detail view: its status may have changed meanwhile, and the server is the one who
 * knows.
 */
export async function changePlacement(p: {
  transcriptionId: string;
  placement: Placement;
}): Promise<TranscriptionView> {
  return requestJson<TranscriptionView>(
    `/api/transcriptions/${encodeURIComponent(p.transcriptionId)}/placement`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ placement: p.placement }),
    },
  );
}

const EVENT_NAMES: readonly TranscriptionEvent['name'][] = [
  'transcription.requested',
  'transcription.started',
  'transcription.segments-appended',
  'transcription.completed',
  'transcription.failed',
  'transcription.requeued',
  'transcription.segment-corrected',
  'transcription.speakers-assigned',
  'transcription.speaker-renamed',
];

function isSpeaker(value: unknown): value is Speaker {
  if (value === null || typeof value !== 'object') return false;
  return (
    'index' in value &&
    typeof value.index === 'number' &&
    'name' in value &&
    (value.name === null || typeof value.name === 'string')
  );
}

function isSegment(value: unknown): value is Segment {
  if (value === null || typeof value !== 'object') return false;
  return (
    'ordinal' in value &&
    typeof value.ordinal === 'number' &&
    'startMs' in value &&
    typeof value.startMs === 'number' &&
    'endMs' in value &&
    typeof value.endMs === 'number' &&
    'text' in value &&
    typeof value.text === 'string' &&
    'corrected' in value &&
    typeof value.corrected === 'boolean' &&
    'speakerIndex' in value &&
    (value.speakerIndex === null || typeof value.speakerIndex === 'number')
  );
}

/**
 * Validates an SSE message before letting its content touch the cache: the stream is a trust
 * boundary, and an unexpected message must be ignored, not propagated.
 */
export function parseTranscriptionEvent(raw: string): TranscriptionEvent | null {
  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return null;
  }
  if (payload === null || typeof payload !== 'object') return null;
  if (!('name' in payload) || typeof payload.name !== 'string') return null;
  const name = payload.name;
  if (!EVENT_NAMES.some((known) => known === name)) return null;
  if (!('transcriptionId' in payload) || typeof payload.transcriptionId !== 'string') return null;
  if (!('occurredAt' in payload) || typeof payload.occurredAt !== 'string') return null;

  if (name === 'transcription.segments-appended') {
    if (!('segments' in payload) || !Array.isArray(payload.segments)) return null;
    if (!payload.segments.every(isSegment)) return null;
  }
  if (name === 'transcription.segment-corrected') {
    if (!('ordinal' in payload) || typeof payload.ordinal !== 'number') return null;
  }
  if (name === 'transcription.speakers-assigned') {
    if (!('speakers' in payload) || !Array.isArray(payload.speakers)) return null;
    if (!payload.speakers.every(isSpeaker)) return null;
    if (!('segments' in payload) || !Array.isArray(payload.segments)) return null;
    if (!payload.segments.every(isSegment)) return null;
  }
  if (name === 'transcription.speaker-renamed') {
    if (!('index' in payload) || typeof payload.index !== 'number') return null;
    if (!('speakerName' in payload) || typeof payload.speakerName !== 'string') return null;
  }
  if (name === 'transcription.failed') {
    if (!('reason' in payload) || typeof payload.reason !== 'string') return null;
  }
  // Every field of the variant was checked above: the shape matches the contract.
  const event = payload as TranscriptionEvent;
  return event;
}
