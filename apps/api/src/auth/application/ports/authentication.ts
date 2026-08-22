/**
 * Identité minimale extraite d'une session. Volontairement réduite à l'identifiant :
 * rien d'autre (email, nom) ne doit circuler dans l'application ni dans les logs.
 */
export type AuthenticatedUser = { readonly id: string };

/**
 * En-têtes d'une requête entrante, décrits structurellement : la couche application exprime
 * son besoin — « les en-têtes portés par l'appelant » — sans importer le transport qui les
 * a produits. `IncomingHttpHeaders` de Node satisfait ce type sans conversion.
 */
export type RequestHeaders = Readonly<Record<string, string | string[] | undefined>>;

/** Lecture de la session portée par une requête entrante. */
export interface SessionReader {
  readSession(headers: RequestHeaders): Promise<AuthenticatedUser | null>;
}
export const SESSION_READER = Symbol('SessionReader');
