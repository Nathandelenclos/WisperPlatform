import { authClient } from './client';

/** Minimum length enforced by better-auth; announced in the form. */
export const MIN_PASSWORD_LENGTH = 8;

/**
 * What went wrong, as a stable code. The failure is raised far from any React tree, so it
 * carries a code rather than a sentence: the interface turns it into the reader's language,
 * and `message` stays the developer-facing English fallback.
 */
export type AuthFailureCode =
  | 'unreachable'
  | 'invalid-credentials'
  | 'sign-up-refused'
  | 'failed';

/** Authentication failure, qualified for the interface. */
export class AuthError extends Error {
  readonly code: AuthFailureCode;

  constructor(code: AuthFailureCode, message: string) {
    super(message);
    this.name = 'AuthError';
    this.code = code;
  }
}

/** The two intents of the sign-in panel. */
export type AuthCommand =
  | { intent: 'sign-in'; email: string; password: string }
  | { intent: 'sign-up'; name: string; email: string; password: string };

type AuthFailure = { status: number; statusText: string; message?: string | undefined };

function toAuthError(failure: AuthFailure, intent: AuthCommand['intent']): AuthError {
  if (failure.status === 0 || failure.status >= 500) {
    return new AuthError('unreachable', 'The authentication server is unreachable.');
  }
  if (intent === 'sign-in' && (failure.status === 401 || failure.status === 403)) {
    return new AuthError('invalid-credentials', 'Incorrect email address or password.');
  }
  if (intent === 'sign-up' && (failure.status === 400 || failure.status === 422)) {
    return new AuthError('sign-up-refused', 'Sign-up refused.');
  }
  return new AuthError('failed', failure.message ?? 'Authentication failed.');
}

/**
 * Runs a sign-in or a sign-up. better-auth updates the session by itself on success: nothing
 * to propagate here.
 */
export async function submitAuthCommand(command: AuthCommand): Promise<void> {
  const result =
    command.intent === 'sign-in'
      ? await authClient.signIn.email({ email: command.email, password: command.password })
      : await authClient.signUp.email({
          name: command.name,
          email: command.email,
          password: command.password,
        });
  if (result.error) throw toAuthError(result.error, command.intent);
}

export async function signOut(): Promise<void> {
  const result = await authClient.signOut();
  if (result.error) throw toAuthError(result.error, 'sign-in');
}

/**
 * Sign-in through Google. Success is not a return value: better-auth redirects the browser to
 * Google, which comes back on `/api/auth/callback/google`. There is therefore nothing to do
 * afterwards, except when the call fails before even leaving — instance without credentials,
 * server unreachable.
 */
export async function signInWithGoogle(): Promise<void> {
  const result = await authClient.signIn.social({
    provider: 'google',
    // We come back where we were: the workspace, not a generic landing page.
    callbackURL: window.location.origin,
  });
  if (result.error) throw toAuthError(result.error, 'sign-in');
}
