import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import {
  parseTranscriptionEvent,
  transcriptionUrls,
  type Segment,
  type TranscriptionEvent,
  type TranscriptionSummary,
  type TranscriptionView,
} from '../api/transcriptions';
import { transcriptionKeys } from './use-transcriptions';

/** Reconnexion bornée : au-delà, on cesse d'insister et la vue reste sur son état. */
const MAX_RECONNECT_ATTEMPTS = 5;
const FIRST_RECONNECT_DELAY_MS = 1_000;
const MAX_RECONNECT_DELAY_MS = 15_000;

function mergeSegments(known: Segment[], incoming: readonly Segment[]): Segment[] {
  // Un lot rejoué ne doit rien dupliquer : l'ordinal est l'identité du segment.
  const seen = new Set(known.map((segment) => segment.ordinal));
  const added = incoming.filter((segment) => !seen.has(segment.ordinal));
  if (added.length === 0) return known;
  return [...known, ...added].sort((left, right) => left.ordinal - right.ordinal);
}

function reduceView(view: TranscriptionView, event: TranscriptionEvent): TranscriptionView {
  switch (event.name) {
    case 'transcription.started':
      // Une nouvelle tentative repart de zéro : les segments de la précédente tombent.
      return { ...view, status: 'transcribing', segments: [], failureReason: null };
    case 'transcription.requeued':
      return { ...view, status: 'pending', segments: [], failureReason: null };
    case 'transcription.segments-appended': {
      const segments = mergeSegments(view.segments, event.segments);
      // Rejeu sans nouveauté : la vue est laissée telle quelle, aucun rendu inutile.
      if (segments === view.segments && view.status === 'transcribing') return view;
      return { ...view, status: 'transcribing', segments };
    }
    case 'transcription.completed':
      return { ...view, status: 'completed', completedAt: event.occurredAt };
    case 'transcription.failed':
      return { ...view, status: 'failed', failureReason: event.reason };
    case 'transcription.segment-corrected':
      return {
        ...view,
        segments: view.segments.map((segment) =>
          segment.ordinal === event.ordinal ? { ...segment, corrected: true } : segment,
        ),
      };
    case 'transcription.requested':
      return view;
  }
}

/**
 * Projette l'événement sur la ligne de liste. `view` est la vue de détail déjà mise à
 * jour : c'est elle qui fait autorité sur le nombre de segments et la durée, la ligne
 * de liste n'ayant pas de quoi dédupliquer un lot rejoué.
 */
function reduceSummary(
  summary: TranscriptionSummary,
  event: TranscriptionEvent,
  view: TranscriptionView | undefined,
): TranscriptionSummary {
  switch (event.name) {
    case 'transcription.started':
      return {
        ...summary,
        status: 'transcribing',
        segmentCount: 0,
        durationMs: 0,
        failureReason: null,
      };
    case 'transcription.requeued':
      return {
        ...summary,
        status: 'pending',
        segmentCount: 0,
        durationMs: 0,
        failureReason: null,
      };
    case 'transcription.segments-appended': {
      if (view === undefined) return { ...summary, status: 'transcribing' };
      const last = view.segments.at(-1);
      return {
        ...summary,
        status: 'transcribing',
        segmentCount: view.segments.length,
        durationMs: last === undefined ? summary.durationMs : last.endMs,
      };
    }
    case 'transcription.completed':
      return { ...summary, status: 'completed', completedAt: event.occurredAt };
    case 'transcription.failed':
      return { ...summary, status: 'failed', failureReason: event.reason };
    case 'transcription.requested':
    case 'transcription.segment-corrected':
      return summary;
  }
}

function applyEvent(queryClient: QueryClient, transcriptionId: string, event: TranscriptionEvent) {
  const detailKey = transcriptionKeys.detail(transcriptionId);

  queryClient.setQueryData<TranscriptionView>(detailKey, (current) =>
    current === undefined ? current : reduceView(current, event),
  );

  const view = queryClient.getQueryData<TranscriptionView>(detailKey);
  queryClient.setQueryData<TranscriptionSummary[]>(transcriptionKeys.list, (current) =>
    current === undefined
      ? current
      : current.map((summary) =>
          summary.id === transcriptionId ? reduceSummary(summary, event, view) : summary,
        ),
  );

  // Un lot émis entre le chargement de la vue et l'abonnement n'a pu être patché :
  // à la transition terminale, une relecture unique remet la vue d'accord avec l'API.
  if (event.name === 'transcription.completed' || event.name === 'transcription.failed') {
    void queryClient.invalidateQueries({ queryKey: detailKey });
    void queryClient.invalidateQueries({ queryKey: transcriptionKeys.list });
  }
}

/**
 * Branche le flux SSE d'une transcription sur le cache : les segments arrivent au fil
 * de l'eau, sans refetch de la vue complète.
 *
 * `enabled` reste faux sur une transcription terminée : plus rien n'a à être diffusé.
 */
export function useTranscriptionEvents(p: {
  transcriptionId: string | null;
  enabled: boolean;
}): void {
  const queryClient = useQueryClient();
  const { transcriptionId, enabled } = p;

  useEffect(() => {
    if (transcriptionId === null || !enabled) return;

    let abandoned = false;
    let attempts = 0;
    let source: EventSource | null = null;
    let retryTimer: number | undefined;

    const connect = () => {
      const stream = new EventSource(transcriptionUrls.events(transcriptionId), {
        withCredentials: true,
      });
      source = stream;

      stream.onopen = () => {
        attempts = 0;
      };

      stream.onmessage = (message: MessageEvent<string>) => {
        const event = parseTranscriptionEvent(message.data);
        if (event !== null) applyEvent(queryClient, transcriptionId, event);
      };

      stream.onerror = () => {
        // `EventSource` réessaie sans fin de lui-même : on reprend la main pour borner.
        stream.close();
        if (abandoned || attempts >= MAX_RECONNECT_ATTEMPTS) return;
        const backoff = Math.min(FIRST_RECONNECT_DELAY_MS * 2 ** attempts, MAX_RECONNECT_DELAY_MS);
        const jitter = 0.7 + Math.random() * 0.6;
        attempts += 1;
        retryTimer = window.setTimeout(connect, backoff * jitter);
      };
    };

    connect();

    return () => {
      abandoned = true;
      window.clearTimeout(retryTimer);
      source?.close();
    };
  }, [transcriptionId, enabled, queryClient]);
}
