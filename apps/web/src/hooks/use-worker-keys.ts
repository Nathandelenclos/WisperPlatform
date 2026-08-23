import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createWorkerKey, listWorkerKeys, revokeWorkerKey } from '../api/worker-keys';

/** Server-state cache key for declared machines. One single list per account. */
export const workerKeyKeys = {
  list: ['worker-keys', 'list'] as const,
};

/**
 * Declared machines. The list is asked for again periodically: its value rests on “seen 3
 * minutes ago”, which tells whether the machine is running. Without that refresh the screen
 * still claimed “never seen” while the worker had just claimed a job — the screen became the
 * one place in the product that lied about the state of its own machine.
 *
 * Thirty seconds: fine enough for a worker just started to appear while one is watching, wide
 * enough not to argue over a value the API itself only writes once a minute per key.
 */
const SIGHTING_REFRESH_MS = 30_000;

export function useWorkerKeys() {
  return useQuery({
    queryKey: workerKeyKeys.list,
    queryFn: ({ signal }) => listWorkerKeys({ signal }),
    refetchInterval: SIGHTING_REFRESH_MS,
    // Coming back to the tab is precisely when one comes to see whether it is running.
    refetchOnWindowFocus: true,
  });
}

/**
 * Declares a machine. The secret returned by the API is **not** written into the cache: it
 * must survive neither a refresh of the list nor the closing of the view that shows it. That
 * view alone holds it, just long enough to copy.
 */
export function useCreateWorkerKey() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: createWorkerKey,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: workerKeyKeys.list }),
  });
}

/** Revokes a machine. The API answers nothing: the list is the truth, so it is asked again. */
export function useRevokeWorkerKey() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: revokeWorkerKey,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: workerKeyKeys.list }),
  });
}
