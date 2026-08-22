import { skipToken, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  correctSegment,
  getTranscription,
  listTranscriptions,
  renameSpeaker,
  requestTranscription,
  type TranscriptionView,
} from '../api/transcriptions';

/** Clés du cache d'état serveur. Une liste, un détail par transcription. */
export const transcriptionKeys = {
  list: ['transcriptions', 'list'] as const,
  detail: (transcriptionId: string) => ['transcriptions', 'detail', transcriptionId] as const,
};

/**
 * Cadence de repli quand le flux d'événements est coupé : la vue continue d'avancer,
 * plus lentement, au lieu de rester figée sur son dernier état connu.
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

/** Dépose un média ; la liste est rafraîchie pour faire apparaître la demande. */
export function useRequestTranscription() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: requestTranscription,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: transcriptionKeys.list }),
  });
}

/**
 * Corrige un segment. Le texte accepté est écrit directement dans le cache : l'API
 * ne renvoie pas la vue, et un refetch complet ferait clignoter l'éditeur.
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
 * Renomme un locuteur pour toute la transcription. L'API répond avec la vue de détail
 * complète : elle est écrite telle quelle dans le cache — l'attribution des segments a pu
 * bouger entre-temps, et le serveur est le seul à savoir dans quel état elle est.
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
