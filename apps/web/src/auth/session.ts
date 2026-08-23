import { authClient } from './client';

/** Longueur minimale imposée par better-auth ; annoncée dans le formulaire. */
export const MIN_PASSWORD_LENGTH = 8;

/** Échec d'authentification, message déjà traduit pour l'utilisateur. */
export class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuthError';
  }
}

/** Les deux intentions du panneau de connexion. */
export type AuthCommand =
  | { intent: 'sign-in'; email: string; password: string }
  | { intent: 'sign-up'; name: string; email: string; password: string };

type AuthFailure = { status: number; statusText: string; message?: string | undefined };

function toAuthError(failure: AuthFailure, intent: AuthCommand['intent']): AuthError {
  if (failure.status === 0 || failure.status >= 500) {
    return new AuthError("Le serveur d'authentification est injoignable. Réessayez dans un instant.");
  }
  if (intent === 'sign-in' && (failure.status === 401 || failure.status === 403)) {
    return new AuthError('Adresse e-mail ou mot de passe incorrect.');
  }
  if (intent === 'sign-up' && (failure.status === 400 || failure.status === 422)) {
    return new AuthError(
      `Inscription refusée : adresse déjà utilisée, ou mot de passe trop court (${MIN_PASSWORD_LENGTH} caractères minimum).`,
    );
  }
  return new AuthError(failure.message ?? "Échec de l'authentification.");
}

/**
 * Exécute une connexion ou une inscription. better-auth met la session à jour de
 * lui-même en cas de succès : rien à propager ici.
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
 * Connexion par Google. Le succès n'est pas un retour de fonction : better-auth redirige le
 * navigateur vers Google, qui revient sur `/api/auth/callback/google`. Il n'y a donc rien à
 * faire après, sauf si l'appel échoue avant même de partir — instance sans identifiants,
 * serveur injoignable.
 */
export async function signInWithGoogle(): Promise<void> {
  const result = await authClient.signIn.social({
    provider: 'google',
    // On revient là où l'on était : l'atelier, pas une page d'accueil générique.
    callbackURL: window.location.origin,
  });
  if (result.error) throw toAuthError(result.error, 'sign-in');
}
