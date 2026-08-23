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

/** Bounded reconnection: past that, we stop insisting and say so to the caller. */
const MAX_RECONNECT_ATTEMPTS = 5;
const FIRST_RECONNECT_DELAY_MS = 1_000;
const MAX_RECONNECT_DELAY_MS = 15_000;

/**
 * Duration past which a connection is held to be established even without a message. A server
 * that accepts then closes at once must not make the budget infinite.
 */
const PROVEN_AFTER_MS = 30_000;

/** State of the stream, as the interface must show it. */
export type StreamState = 'idle' | 'connecting' | 'live' | 'lost';

function isTerminal(status: TranscriptionStatus): boolean {
  return status === 'completed' || status === 'failed';
}

function mergeSegments(known: Segment[], incoming: readonly Segment[]): Segment[] {
  // A replayed batch must duplicate nothing: the ordinal is the identity of the segment.
  const seen = new Set(known.map((segment) => segment.ordinal));
  const added = incoming.filter((segment) => !seen.has(segment.ordinal));
  if (added.length === 0) return known;
  return [...known, ...added].sort((left, right) => left.ordinal - right.ordinal);
}

function reduceView(view: TranscriptionView, event: TranscriptionEvent): TranscriptionView {
  switch (event.name) {
    case 'transcription.started':
      // Sticky terminal status: a late `started` must not empty the transcript.
      if (isTerminal(view.status)) return view;
      // A new attempt starts from scratch: the segments of the previous one fall.
      return { ...view, status: 'transcribing', segments: [], speakers: [], failureReason: null };
    case 'transcription.requeued':
      if (isTerminal(view.status)) return view;
      return { ...view, status: 'pending', segments: [], speakers: [], failureReason: null };
    case 'transcription.segments-appended': {
      const segments = mergeSegments(view.segments, event.segments);
      // A late batch completes the segments without dragging the view back to “running”.
      const status = isTerminal(view.status) ? view.status : 'transcribing';
      // Replay with nothing new: the view is left as it is, no useless render.
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
    case 'transcription.speakers-assigned': {
      // The pass recomputes the assignment from scratch and republishes every segment: the
      // batch received is therefore authoritative on the speaker. The known text is not
      // overwritten — a correction more recent than the pass must not regress.
      const merged = mergeSegments(view.segments, event.segments);
      const assigned = new Map(
        event.segments.map((segment) => [segment.ordinal, segment.speakerIndex]),
      );
      return {
        ...view,
        speakers: event.speakers,
        segments: merged.map((segment) => {
          const speakerIndex = assigned.get(segment.ordinal) ?? null;
          return segment.speakerIndex === speakerIndex ? segment : { ...segment, speakerIndex };
        }),
      };
    }
    case 'transcription.speaker-renamed':
      return {
        ...view,
        speakers: view.speakers.map((speaker) =>
          speaker.index === event.index ? { ...speaker, name: event.speakerName } : speaker,
        ),
      };
    case 'transcription.requested':
      return view;
  }
}

/**
 * Projects the event onto the list row. `view` is the detail view already updated: it is
 * authoritative on the segment count and the duration, the list row having nothing to
 * deduplicate a replayed batch with.
 */
function reduceSummary(
  summary: TranscriptionSummary,
  event: TranscriptionEvent,
  view: TranscriptionView | undefined,
): TranscriptionSummary {
  switch (event.name) {
    case 'transcription.started':
      // Same rule as on the detail: the terminal state does not regress.
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
    // The segment count does not move: diarisation adds none, it only assigns them a
    // speaker — and the list row shows no speaker at all.
    case 'transcription.speakers-assigned':
    case 'transcription.speaker-renamed':
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

  // A batch emitted between the loading of the view and the subscription could not be
  // patched: on the terminal transition, a single re-read puts the view back in agreement
  // with the API.
  if (event.name === 'transcription.completed' || event.name === 'transcription.failed') {
    void queryClient.invalidateQueries({ queryKey: detailKey });
    void queryClient.invalidateQueries({ queryKey: transcriptionKeys.list });
  }
}

/**
 * Wires the SSE stream of a transcription onto the cache: segments arrive as they come, with
 * no refetch of the complete view.
 *
 * The stream has neither buffer nor replay on the server side: everything emitted during a
 * cut is lost. Each connection therefore restarts from a snapshot of the server, the stream
 * carrying only the delta afterwards.
 *
 * `enabled` stays false on a finished transcription: there is nothing left to broadcast.
 * `resumeToken` serves the manual retry: changing it reopens the stream from scratch.
 */
export function useTranscriptionEvents(p: {
  transcriptionId: string | null;
  enabled: boolean;
  resumeToken: number;
  onStateChange: (state: StreamState) => void;
}): void {
  const queryClient = useQueryClient();
  const { transcriptionId, enabled, resumeToken, onStateChange } = p;

  // The state report goes through a ref: a callback recreated on every render must not
  // restart the effect, on pain of reconnecting in a loop.
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
        // Resynchronisation: whatever was emitted before this connection will never arrive.
        void queryClient.invalidateQueries({
          queryKey: transcriptionKeys.detail(transcriptionId),
        });
        void queryClient.invalidateQueries({ queryKey: transcriptionKeys.list });
      };

      stream.onmessage = (message: MessageEvent<string>) => {
        // A message received proves the connection: the reconnection budget may restart.
        proven = true;
        attempts = 0;
        const event = parseTranscriptionEvent(message.data);
        if (event !== null) applyEvent(queryClient, transcriptionId, event);
      };

      stream.onerror = () => {
        // `EventSource` retries endlessly by itself: we take over in order to bound it.
        stream.close();
        if (abandoned) return;
        // The budget only restarts on a proven stream, otherwise a server that accepts then
        // closes at once would have us reconnect forever.
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
