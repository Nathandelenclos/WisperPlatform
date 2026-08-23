import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createWorkerKey, listWorkerKeys, revokeWorkerKey } from '../api/worker-keys';

/** Clé du cache d'état serveur des machines déclarées. Une seule liste par compte. */
export const workerKeyKeys = {
  list: ['worker-keys', 'list'] as const,
};

/**
 * Machines déclarées. La liste se redemande périodiquement : sa valeur tient à « vue il y a
 * 3 minutes », qui dit si la machine tourne. Sans ce rafraîchissement, l'écran affirmait
 * encore « jamais vue » alors que le worker venait de réclamer un job — l'écran devenait le
 * seul endroit du produit qui mentait sur l'état de sa propre machine.
 *
 * Trente secondes : assez fin pour qu'un worker qu'on vient de lancer apparaisse pendant
 * qu'on regarde, assez large pour ne pas discuter une donnée que l'API n'écrit, elle, qu'une
 * fois par minute par clé.
 */
const SIGHTING_REFRESH_MS = 30_000;

export function useWorkerKeys() {
  return useQuery({
    queryKey: workerKeyKeys.list,
    queryFn: ({ signal }) => listWorkerKeys({ signal }),
    refetchInterval: SIGHTING_REFRESH_MS,
    // Revenir sur l'onglet, c'est justement le moment où l'on vient voir si ça tourne.
    refetchOnWindowFocus: true,
  });
}

/**
 * Déclare une machine. Le secret rendu par l'API n'est **pas** écrit dans le cache : il ne
 * doit survivre ni à un rafraîchissement de la liste, ni à la fermeture de la vue qui
 * l'affiche. Seule cette vue le tient, le temps qu'on le copie.
 */
export function useCreateWorkerKey() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: createWorkerKey,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: workerKeyKeys.list }),
  });
}

/** Révoque une machine. L'API ne répond rien : la liste fait foi, on la redemande. */
export function useRevokeWorkerKey() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: revokeWorkerKey,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: workerKeyKeys.list }),
  });
}
