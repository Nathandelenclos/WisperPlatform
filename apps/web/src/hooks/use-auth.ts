import { useMutation, useQueryClient } from '@tanstack/react-query';
import { signInWithGoogle, signOut, submitAuthCommand } from '../auth/session';

/** Sign-in or sign-up: a single command, hence a single submitting state. */
export function useAuthCommand() {
  return useMutation({ mutationFn: submitAuthCommand });
}

/**
 * Google sign-in. Success leaves the page: the submitting state only covers the outbound
 * trip, and only a failure before the redirect comes back here.
 */
export function useGoogleSignIn() {
  return useMutation({ mutationFn: signInWithGoogle });
}

export function useSignOut() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: signOut,
    onSuccess: () => {
      // No data from the previous account may survive the sign-out.
      queryClient.clear();
    },
  });
}
