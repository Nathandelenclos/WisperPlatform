import { createAuthClient } from 'better-auth/react';

/**
 * Client better-auth. Même origine que le client : les routes d'authentification
 * sont servies sous `/api/auth` et la session voyage par cookie.
 */
export const authClient = createAuthClient({
  baseURL: window.location.origin,
  basePath: '/api/auth',
});

/** Session courante (`data`, `isPending`, `error`), tenue à jour par better-auth. */
export const useSession = authClient.useSession;
