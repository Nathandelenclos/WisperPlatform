import { createAuthClient } from 'better-auth/react';

/**
 * better-auth client. Same origin as the page: the authentication routes are served under
 * `/api/auth` and the session travels by cookie.
 */
export const authClient = createAuthClient({
  baseURL: window.location.origin,
  basePath: '/api/auth',
});

/** Current session (`data`, `isPending`, `error`), kept up to date by better-auth. */
export const useSession = authClient.useSession;
