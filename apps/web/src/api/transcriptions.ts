import { requestJson, requestNoContent } from './http';

/** Modèles whisper servis par la plateforme (contrat du domaine). */
export const WHISPER_MODELS = ['tiny', 'base', 'small', 'medium', 'large', 'turbo'] as const;
export type WhisperModel = (typeof WHISPER_MODELS)[number];

export const DEFAULT_MODEL: WhisperModel = 'medium';
export const DEFAULT_LANGUAGE = 'French';

/**
 * Langues proposées. La valeur part en argument de processus côté worker : le domaine
 * n'accepte que `/^[A-Za-z]{2,32}$/`, un choix fermé garantit cette contrainte.
 */
export const TRANSCRIPTION_LANGUAGES: readonly { value: string; label: string }[] = [
  { value: 'French', label: 'Français' },
  { value: 'English', label: 'Anglais' },
  { value: 'Spanish', label: 'Espagnol' },
  { value: 'German', label: 'Allemand' },
  { value: 'Italian', label: 'Italien' },
  { value: 'Portuguese', label: 'Portugais' },
  { value: 'Dutch', label: 'Néerlandais' },
  { value: 'Russian', label: 'Russe' },
  { value: 'Arabic', label: 'Arabe' },
  { value: 'Japanese', label: 'Japonais' },
  { value: 'Chinese', label: 'Chinois' },
  { value: 'Korean', label: 'Coréen' },
];

/** Reflète `MEDIA_MAX_BYTES` côté API (2 Gio). Le serveur reste seul juge. */
export const MEDIA_MAX_BYTES = 2_147_483_648;

export type TranscriptionStatus = 'pending' | 'transcribing' | 'completed' | 'failed';

export type Segment = {
  ordinal: number;
  startMs: number;
  endMs: number;
  text: string;
  corrected: boolean;
  /** Locuteur attribué par la diarisation ; `null` quand aucun tour ne recouvre le segment. */
  speakerIndex: number | null;
};

/**
 * Locuteur découvert par la diarisation. L'index est technique (produit par le clustering) ;
 * `name` est celui que le propriétaire a donné, `null` tant que personne n'a renommé.
 */
export type Speaker = {
  index: number;
  name: string | null;
};

/** Vue de liste. Dates sérialisées en ISO 8601 par l'API. */
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
};

/** Vue de détail, segments inclus. */
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
  segments: Segment[];
  /** Locuteurs découverts. Vide quand la diarisation n'a pas eu lieu. */
  speakers: Speaker[];
};

export const SUBTITLE_FORMATS = ['srt', 'vtt', 'txt'] as const;
export type SubtitleFormat = (typeof SUBTITLE_FORMATS)[number];

/**
 * Événements de domaine reçus sur le flux SSE. Un seul champ discriminant : `name`.
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
      /** Tous les segments, `speakerIndex` à jour : la passe recalcule l'attribution. */
      segments: Segment[];
    }
  | {
      name: 'transcription.speaker-renamed';
      transcriptionId: string;
      occurredAt: string;
      index: number;
      /** `speakerName`, et non `name` : ce dernier porte déjà le nom de l'événement. */
      speakerName: string;
    };

/** URL servies directement au navigateur (lecteur média, liens d'export, flux SSE). */
export const transcriptionUrls = {
  media: (id: string): string => `/api/transcriptions/${encodeURIComponent(id)}/media`,
  export: (id: string, format: SubtitleFormat): string =>
    `/api/transcriptions/${encodeURIComponent(id)}/export?format=${format}`,
  events: (id: string): string => `/api/transcriptions/${encodeURIComponent(id)}/events`,
};

/**
 * Plafond de l'envoi d'un média : `MEDIA_MAX_BYTES` à ~1 Mo/s. Généreux, mais borné —
 * un transfert interrompu ne doit pas laisser la requête pendante indéfiniment.
 */
const UPLOAD_TIMEOUT_MS = 40 * 60_000;

/** Dépose un média et demande sa transcription. */
export async function requestTranscription(p: {
  file: File;
  model: WhisperModel;
  language: string;
}): Promise<{ id: string }> {
  const form = new FormData();
  form.append('file', p.file);
  form.append('model', p.model);
  form.append('language', p.language);
  return requestJson<{ id: string }>('/api/transcriptions', {
    method: 'POST',
    body: form,
    timeoutMs: UPLOAD_TIMEOUT_MS,
  });
}

/**
 * Transcriptions de l'utilisateur connecté, les plus récentes d'abord. Le signal vient
 * de React Query : une requête devenue inutile est annulée au lieu de courir jusqu'au bout.
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

/** Corrige le texte d'un segment déjà transcrit. */
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
 * Renomme un locuteur pour toute la transcription. L'API répond avec la vue de détail
 * complète : c'est elle qui fait autorité, le client n'a rien à recomposer.
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
 * Valide un message SSE avant de laisser son contenu toucher le cache : le flux est
 * une frontière de confiance, un message inattendu doit être ignoré, pas propagé.
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
  // Chaque champ du variant a été vérifié ci-dessus : la forme correspond au contrat.
  const event = payload as TranscriptionEvent;
  return event;
}
