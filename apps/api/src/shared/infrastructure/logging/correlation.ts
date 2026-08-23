import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';

/**
 * Correlation identifier of the request being served. It is carried by an asynchronous context
 * rather than passed from hand to hand: without it, an application line — a media access
 * refusal, for instance — cannot be tied back to the request that caused it, which is exactly
 * the diagnosis these logs exist to make possible.
 */
export const correlationStorage = new AsyncLocalStorage<string>();

/** An incoming header only becomes an identifier when it is short and free of surprises. */
const SAFE_REQUEST_ID = /^[A-Za-z0-9._-]{1,128}$/;

/**
 * Reuses the identifier supplied by the caller when it is harmless, otherwise generates one.
 * `existing` allows staying aligned on an identifier already assigned upstream.
 */
export function resolveCorrelationId(candidate: unknown, existing?: unknown): string {
  for (const value of [existing, candidate]) {
    if (typeof value === 'string' && SAFE_REQUEST_ID.test(value)) {
      return value;
    }
  }
  return randomUUID();
}

export const CORRELATION_ID_HEADER = 'x-request-id';
