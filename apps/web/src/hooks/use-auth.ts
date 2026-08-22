import { useMutation, useQueryClient } from '@tanstack/react-query';
import { signOut, submitAuthCommand } from '../auth/session';

/** Connexion ou inscription : une seule commande, donc un seul état d'envoi. */
export function useAuthCommand() {
  return useMutation({ mutationFn: submitAuthCommand });
}

export function useSignOut() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: signOut,
    onSuccess: () => {
      // Aucune donnée du compte précédent ne doit survivre à la déconnexion.
      queryClient.clear();
    },
  });
}
