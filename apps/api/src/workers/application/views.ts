import type { WorkerKeyState } from '../domain/worker-key';

/**
 * What the owner sees of one of their machines. Neither the secret nor its fingerprint: the
 * former exists once only, the latter is nobody's business.
 */
export type WorkerKeyView = {
  id: string;
  label: string;
  createdAt: Date;
  lastSeenAt: Date | null;
  revokedAt: Date | null;
};

/**
 * Response to the declaration of a machine: the usual view, plus the plaintext secret.
 * This is the ONLY place in the system where it appears.
 */
export type RegisteredWorkerKeyView = WorkerKeyView & { secret: string };

/**
 * Projection from the aggregate to what the owner sees. It lives here, in a single place: two
 * use cases return this view, and they must return exactly the same one.
 */
export function toWorkerKeyView(state: WorkerKeyState): WorkerKeyView {
  return {
    id: state.id,
    label: state.label,
    createdAt: state.createdAt,
    lastSeenAt: state.lastSeenAt,
    revokedAt: state.revokedAt,
  };
}
