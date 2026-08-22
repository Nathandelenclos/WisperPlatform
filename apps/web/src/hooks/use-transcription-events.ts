import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import {
  parseTranscriptionEvent,
  transcriptionUrls,
  type Segment,
  type TranscriptionEvent,
  type TranscriptionStatus,
  type TranscriptionSummary,
  type TranscriptionView,
} from '../api/transcriptions';
import { transcriptionKeys } from './use-transcriptions';

/** Reconnexion bornée : au-delà, on cesse d'insister et on le dit à l'appelant. */
const MAX_RECONNECT_ATTEMPTS = 5;
const FIRST_RECONNECT_DELAY_MS = 1_000;
const MAX_RECONNECT_DELAY_MS = 15_000;

/**
 * Durée au-delà de laquelle une connexion est tenue pour établie même sans message.
 * Un serveur qui accepte puis referme aussitôt ne doit pas rendre le budget infini.
 */
const PROVEN_AFTER_MS = 30_000;

/** État du flux, tel que l'interface doit le montrer. */
export type StreamState = 'idle' | 'connecting' | 'live' | 'lost';

function isTerminal(status: TranscriptionStatus): boolean {
  return status === 'completed' || status === 'failed';
}

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
      // Statut terminal collant : un `started` en retard ne doit pas vider le transcrit.
      if (isTerminal(view.status)) return view;
      // Une nouvelle tentative repart de zéro : les segments de la précédente tombent.
      return { ...view, status: 'transcribing', segments: [], failureReason: null };
    case 'transcription.requeued':
      if (isTerminal(view.status)) return view;
      return { ...view, status: 'pending', segments: [], failureReason: null };
    case 'transcription.segments-appended': {
      const segments = mergeSegments(view.segments, event.segments);
      // Un lot en retard complète les segments sans ramener la vue à « en cours ».
      const status = isTerminal(view.status) ? view.status : 'transcribing';
      // Rejeu sans nouveauté : la vue est laissée telle quelle, aucun rendu inutile.
      if (segments === view.segments && status === view.status) return view;
      return { ...view, status, segments };
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
      // Même règle que sur le détail : le terminal ne régresse pas.
      if (isTerminal(summary.status)) return summary;
      return {
        ...summary,
        status: 'transcribing',
        segmentCount: 0,
        durationMs: 0,
        failureReason: null,
      };
    case 'transcription.requeued':
      if (isTerminal(summary.status)) return summary;
      return {
        ...summary,
        status: 'pending',
        segmentCount: 0,
        durationMs: 0,
        failureReason: null,
      };
    case 'transcription.segments-appended': {
      const status = isTerminal(summary.status) ? summary.status : 'transcribing';
      if (view === undefined) return { ...summary, status };
      const last = view.segments.at(-1);
      return {
        ...summary,
        status,
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
 * Le flux n'a ni tampon ni rejeu côté serveur : tout ce qui est émis pendant une
 * coupure est perdu. Chaque connexion repart donc d'un instantané du serveur, le flux
 * ne portant ensuite que le delta.
 *
 * `enabled` reste faux sur une transcription terminée : plus rien n'a à être diffusé.
 * `resumeToken` sert la reprise manuelle : le changer rouvre le flux depuis zéro.
 */
export function useTranscriptionEvents(p: {
  transcriptionId: string | null;
  enabled: boolean;
  resumeToken: number;
  onStateChange: (state: StreamState) => void;
}): void {
  const queryClient = useQueryClient();
  const { transcriptionId, enabled, resumeToken, onStateChange } = p;

  // Le rapport d'état passe par une ref : un callback recréé à chaque rendu ne doit
  // pas relancer l'effet, sous peine de reconnecter en boucle.
  const report = useRef(onStateChange);
  useEffect(() => {
    report.current = onStateChange;
  }, [onStateChange]);

  useEffect(() => {
    if (transcriptionId === null || !enabled) {
      report.current('idle');
      return;
    }
    report.current('connecting');

    let abandoned = false;
    let attempts = 0;
    let source: EventSource | null = null;
    let retryTimer: number | undefined;

    const connect = () => {
      const stream = new EventSource(transcriptionUrls.events(transcriptionId), {
        withCredentials: true,
      });
      source = stream;
      let openedAt = 0;
      let proven = false;

      stream.onopen = () => {
        openedAt = Date.now();
        report.current('live');
        // Resynchronisation : ce qui a été émis avant cette connexion n'arrivera jamais.
        void queryClient.invalidateQueries({
          queryKey: transcriptionKeys.detail(transcriptionId),
        });
        void queryClient.invalidateQueries({ queryKey: transcriptionKeys.list });
      };

      stream.onmessage = (message: MessageEvent<string>) => {
        // Un message reçu prouve la connexion : le budget de reconnexion peut repartir.
        proven = true;
        attempts = 0;
        const event = parseTranscriptionEvent(message.data);
        if (event !== null) applyEvent(queryClient, transcriptionId, event);
      };

      stream.onerror = () => {
        // `EventSource` réessaie sans fin de lui-même : on reprend la main pour borner.
        stream.close();
        if (abandoned) return;
        // Le budget ne repart que sur un flux prouvé, sinon un serveur qui accepte puis
        // referme aussitôt ferait reconnecter indéfiniment.
        if (proven || (openedAt !== 0 && Date.now() - openedAt >= PROVEN_AFTER_MS)) attempts = 0;
        if (attempts >= MAX_RECONNECT_ATTEMPTS) {
          report.current('lost');
          return;
        }
        report.current('connecting');
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
  }, [transcriptionId, enabled, resumeToken, queryClient]);
}
