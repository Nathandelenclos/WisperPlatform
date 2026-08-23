import { useMutation, useQueryClient } from '@tanstack/react-query';
import { signInWithGoogle, signOut, submitAuthCommand } from '../auth/session';

/** Connexion ou inscription : une seule commande, donc un seul état d'envoi. */
export function useAuthCommand() {
  return useMutation({ mutationFn: submitAuthCommand });
}

/**
 * Connexion Google. Le succès quitte la page : l'état d'envoi ne sert qu'à couvrir l'aller,
 * et seul un échec avant la redirection revient ici.
 */
export function useGoogleSignIn() {
  return useMutation({ mutationFn: signInWithGoogle });
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
