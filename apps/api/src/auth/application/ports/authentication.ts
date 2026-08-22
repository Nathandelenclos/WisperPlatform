import type { IncomingHttpHeaders, IncomingMessage, ServerResponse } from 'node:http';

/**
 * Identité minimale extraite d'une session. Volontairement réduite à l'identifiant :
 * rien d'autre (email, nom) ne doit circuler dans l'application ni dans les logs.
 */
export type AuthenticatedUser = { readonly id: string };

/** Lecture de la session portée par une requête entrante. */
export interface SessionReader {
  readSession(headers: IncomingHttpHeaders): Promise<AuthenticatedUser | null>;
}
export const SESSION_READER = Symbol('SessionReader');

/**
 * Délégation des routes d'authentification au fournisseur d'identité.
 * La requête est transmise brute : le fournisseur lit lui-même le corps.
 */
export interface AuthRequestHandler {
  handle(request: IncomingMessage, response: ServerResponse): Promise<void>;
}
export const AUTH_REQUEST_HANDLER = Symbol('AuthRequestHandler');
