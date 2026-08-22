import { skipToken, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  correctSegment,
  getTranscription,
  listTranscriptions,
  requestTranscription,
  type TranscriptionView,
} from '../api/transcriptions';

/** Clés du cache d'état serveur. Une liste, un détail par transcription. */
export const transcriptionKeys = {
  list: ['transcriptions', 'list'] as const,
  detail: (transcriptionId: string) => ['transcriptions', 'detail', transcriptionId] as const,
};

export function useTranscriptionList() {
  return useQuery({ queryKey: transcriptionKeys.list, queryFn: listTranscriptions });
}

export function useTranscription(transcriptionId: string | null) {
  return useQuery({
    queryKey: transcriptionKeys.detail(transcriptionId ?? 'none'),
    queryFn:
      transcriptionId === null ? skipToken : () => getTranscription(transcriptionId),
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
