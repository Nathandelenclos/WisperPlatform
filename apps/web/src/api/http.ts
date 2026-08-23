/**
 * HTTP access to the API. Every route is relative (`/api/...`): the client and the API share
 * the origin, so the better-auth session travels by cookie.
 */

/** Error carrying the stable `code` returned by the API (`{ error: { code, message } }`). */
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
  let message = response.statusText || 'Request refused by the server.';
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
    // Response with no usable JSON body: the status alone qualifies the error.
  }
  return new ApiError({ code, message, status: response.status });
}

/** No request waits forever; the caller may lengthen the deadline. */
const DEFAULT_TIMEOUT_MS = 15_000;

/** `RequestInit`, plus the time limit specific to the request. */
export type RequestOptions = RequestInit & { timeoutMs?: number };

async function send(path: string, init: RequestOptions): Promise<Response> {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, ...request } = init;
  // The caller's signal (React Query aborts a request that became useless) and the time
  // bound both apply: abortable without ceasing to be bounded.
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
    // Abort asked for by the caller: not a failure, so it is propagated as it stands.
    if (caller !== null && caller.aborted) throw cause;
    const timedOut = cause instanceof DOMException && cause.name === 'TimeoutError';
    // These two never reached the API, so no server message covers them: the code is stable
    // and the interface translates it. The text here is the developer-facing fallback.
    throw new ApiError({
      code: timedOut ? 'request_timeout' : 'network_unreachable',
      message: timedOut
        ? 'The server did not answer within the allotted time.'
        : 'Server unreachable. Check your connection.',
      status: 0,
    });
  }
  if (!response.ok) throw await toApiError(response);
  return response;
}

/** Request expecting a JSON body. Throws an `ApiError` on a non-2xx response. */
export async function requestJson<T>(path: string, init: RequestOptions = {}): Promise<T> {
  const response = await send(path, {
    ...init,
    headers: { Accept: 'application/json', ...init.headers },
  });
  return (await response.json()) as T;
}

/** Request with no useful response body (204). Throws an `ApiError` on a non-2xx response. */
export async function requestNoContent(path: string, init: RequestOptions): Promise<void> {
  await send(path, init);
}
