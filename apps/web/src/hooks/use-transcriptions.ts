import { skipToken, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  changePlacement,
  correctSegment,
  getTranscription,
  listTranscriptions,
  renameSpeaker,
  requestTranscription,
  type Placement,
  type TranscriptionView,
} from '../api/transcriptions';

/** Server-state cache keys. One list, one detail per transcription. */
export const transcriptionKeys = {
  list: ['transcriptions', 'list'] as const,
  detail: (transcriptionId: string) => ['transcriptions', 'detail', transcriptionId] as const,
};

/**
 * Fallback cadence when the event stream is cut: the view keeps moving forward, more slowly,
 * instead of freezing on its last known state.
 */
const DEGRADED_POLL_MS = 5_000;

export function useTranscriptionList() {
  return useQuery({
    queryKey: transcriptionKeys.list,
    queryFn: ({ signal }) => listTranscriptions({ signal }),
  });
}

export function useTranscription(transcriptionId: string | null, p: { degraded?: boolean } = {}) {
  return useQuery({
    queryKey: transcriptionKeys.detail(transcriptionId ?? 'none'),
    queryFn:
      transcriptionId === null
        ? skipToken
        : ({ signal }) => getTranscription(transcriptionId, { signal }),
    refetchInterval: p.degraded === true ? DEGRADED_POLL_MS : false,
  });
}

/** Uploads a media file; the list is refreshed so the request shows up. */
export function useRequestTranscription() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: requestTranscription,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: transcriptionKeys.list }),
  });
}

/**
 * Corrects a segment. The accepted text is written straight into the cache: the API does not
 * return the view, and a full refetch would make the editor flicker.
 */
export function useCorrectSegment(transcriptionId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (correction: { ordinal: number; text: string }) =>
      correctSegment({ transcriptionId, ...correction }),
    onSuccess: (_result, correction) => {
      queryClient.setQueryData<TranscriptionView>(
        transcriptionKeys.detail(transcriptionId),
        (current) => {
          if (current === undefined) return current;
          return {
            ...current,
            segments: current.segments.map((segment) =>
              segment.ordinal === correction.ordinal
                ? { ...segment, text: correction.text, corrected: true }
                : segment,
            ),
          };
        },
      );
    },
  });
}

/**
 * Renames a speaker across the whole transcription. The API answers with the complete detail
 * view: it is written into the cache as it stands — the segment assignment may have moved
 * meanwhile, and only the server knows what state it is in.
 */
export function useRenameSpeaker(transcriptionId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (rename: { index: number; name: string }) =>
      renameSpeaker({ transcriptionId, ...rename }),
    onSuccess: (view) => {
      queryClient.setQueryData<TranscriptionView>(transcriptionKeys.detail(transcriptionId), view);
    },
  });
}

/**
 * Hands a pending transcription to the other side. The detail view returned is authoritative;
 * the library is re-queried because the summary carries the placement too — without that, the
 * row would go on announcing a wait that no longer applies.
 */
export function useChangePlacement(transcriptionId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (placement: Placement) => changePlacement({ transcriptionId, placement }),
    onSuccess: (view) => {
      queryClient.setQueryData<TranscriptionView>(transcriptionKeys.detail(transcriptionId), view);
      void queryClient.invalidateQueries({ queryKey: transcriptionKeys.list });
    },
  });
}
