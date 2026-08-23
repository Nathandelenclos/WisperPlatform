/**
 * Minimal identity extracted from a session. Deliberately reduced to the identifier:
 * nothing else (email, name) is to travel through the application nor through the logs.
 */
export type AuthenticatedUser = { readonly id: string };

/**
 * Headers of an incoming request, described structurally: the application layer states its
 * need — "the headers carried by the caller" — without importing the transport that produced
 * them. Node's `IncomingHttpHeaders` satisfies this type with no conversion.
 */
export type RequestHeaders = Readonly<Record<string, string | string[] | undefined>>;

/** Reading of the session carried by an incoming request. */
export interface SessionReader {
  readSession(headers: RequestHeaders): Promise<AuthenticatedUser | null>;
}
export const SESSION_READER = Symbol('SessionReader');
