/**
 * What the platform infers from a worker's bearer token: who it works for.
 *
 * - `service`: a platform worker, which carries the shared secret;
 * - `owner`: a machine declared by a user, which carries a machine key.
 *
 * This is the only fact the queue needs. A worker is never both, and a claimant is never
 * offered the other one's work.
 */
export type Claimant = { kind: 'service' } | { kind: 'owner'; ownerId: string };

/**
 * Resolution of the bearer token presented by a worker. `null` means "unknown token" —
 * wrong shared secret, non-existent key or revoked key, indistinguishably: nothing must let a
 * token bearer guess which of the three.
 */
export interface WorkerIdentities {
  resolve(bearerToken: string): Promise<Claimant | null>;
}

export const WORKER_IDENTITIES = Symbol('WorkerIdentities');
