import { requestJson, requestNoContent } from './http';

/**
 * Machine keys: what a user creates to attach THEIR machine to their account. The secret is
 * pasted into the worker's start command; the API returns it once, at creation, and keeps
 * nothing but a fingerprint of it.
 */

/** Mirrors the domain constraint on the label. The server remains the only judge. */
export const WORKER_KEY_LABEL_MAX = 60;

/** Declared machine, as the list gives it — never a secret, never a fingerprint. */
export type WorkerKey = {
  id: string;
  label: string;
  createdAt: string;
  /** Last call of a worker carrying this key; `null` as long as none has shown up. */
  lastSeenAt: string | null;
  /** Revocation date; `null` as long as the key serves. */
  revokedAt: string | null;
};

/**
 * Answer to the creation. `secret` appears THERE and nowhere else: it is stored in the clear
 * neither on the server nor in the client cache — the view holds it just long enough to copy.
 */
export type CreatedWorkerKey = {
  id: string;
  label: string;
  createdAt: string;
  secret: string;
};

export async function listWorkerKeys(p: { signal?: AbortSignal } = {}): Promise<WorkerKey[]> {
  return requestJson<WorkerKey[]>('/api/worker-keys', { signal: p.signal });
}

export async function createWorkerKey(p: { label: string }): Promise<CreatedWorkerKey> {
  return requestJson<CreatedWorkerKey>('/api/worker-keys', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ label: p.label }),
  });
}

/** Revokes a key. The machine stays listed, marked revoked: its history counts. */
export async function revokeWorkerKey(p: { id: string }): Promise<void> {
  await requestNoContent(`/api/worker-keys/${encodeURIComponent(p.id)}`, { method: 'DELETE' });
}

/**
 * Start command, ready to paste. The origin is the page's own: the worker must reach the same
 * API as the browser, and guessing it would be one more source of error.
 *
 * A single line, and a published image: nobody lends a processor core at the price of a clone
 * and a three-gigabyte build. The `latest` tag follows the default branch, published by CI
 * after the vulnerability scan.
 */
export function workerRunCommand(p: { origin: string; secret: string }): string {
  return [
    'docker run --rm',
    `-e WISPER_API_URL=${p.origin}`,
    `-e WISPER_WORKER_TOKEN=${p.secret}`,
    'ghcr.io/nathandelenclos/wisper-worker:latest',
  ].join(' ');
}
