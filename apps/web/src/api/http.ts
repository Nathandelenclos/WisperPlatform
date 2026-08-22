/**
 * Accès HTTP à l'API. Toutes les routes sont relatives (`/api/...`) : le client et
 * l'API partagent l'origine, la session better-auth voyage donc par cookie.
 */

/** Erreur portant le `code` stable renvoyé par l'API (`{ error: { code, message } }`). */
export class ApiError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(p: { code: string; message: string; status: number }) {
    super(p.message);
    this.name = 'ApiError';
    this.code = p.code;
    this.status = p.status;
  }
}

async function toApiError(response: Response): Promise<ApiError> {
  let code = `http_${response.status}`;
  let message = response.statusText || 'Requête refusée par le serveur.';
  try {
    const body: unknown = await response.json();
    if (body !== null && typeof body === 'object' && 'error' in body) {
      const detail: unknown = body.error;
      if (detail !== null && typeof detail === 'object') {
        if ('code' in detail && typeof detail.code === 'string') code = detail.code;
        if ('message' in detail && typeof detail.message === 'string') message = detail.message;
      }
    }
  } catch {
    // Réponse sans corps JSON exploitable : le statut suffit à qualifier l'erreur.
  }
  return new ApiError({ code, message, status: response.status });
}

/** Aucune requête n'attend indéfiniment ; l'appelant peut allonger le délai. */
const DEFAULT_TIMEOUT_MS = 15_000;

/** `RequestInit`, plus le délai maximal propre à la requête. */
export type RequestOptions = RequestInit & { timeoutMs?: number };

async function send(path: string, init: RequestOptions): Promise<Response> {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, ...request } = init;
  // Le signal de l'appelant (React Query annule une requête devenue inutile) et la
  // borne de temps s'appliquent tous les deux : annulable sans cesser d'être borné.
  const caller = init.signal ?? null;
  const deadline = AbortSignal.timeout(timeoutMs);
  let response: Response;
  try {
    response = await fetch(path, {
      credentials: 'include',
      ...request,
      signal: caller === null ? deadline : AbortSignal.any([caller, deadline]),
    });
  } catch (cause) {
    // Annulation demandée par l'appelant : ce n'est pas une panne, on la propage telle quelle.
    if (caller !== null && caller.aborted) throw cause;
    const timedOut = cause instanceof DOMException && cause.name === 'TimeoutError';
    throw new ApiError({
      code: timedOut ? 'request_timeout' : 'network_unreachable',
      message: timedOut
        ? "Le serveur n'a pas répondu dans le délai imparti."
        : 'Serveur injoignable. Vérifiez votre connexion.',
      status: 0,
    });
  }
  if (!response.ok) throw await toApiError(response);
  return response;
}

/** Requête attendant un corps JSON. Lève une `ApiError` sur réponse non 2xx. */
export async function requestJson<T>(path: string, init: RequestOptions = {}): Promise<T> {
  const response = await send(path, {
    ...init,
    headers: { Accept: 'application/json', ...init.headers },
  });
  return (await response.json()) as T;
}

/** Requête sans corps de réponse utile (204). Lève une `ApiError` sur réponse non 2xx. */
export async function requestNoContent(path: string, init: RequestOptions): Promise<void> {
  await send(path, init);
}
