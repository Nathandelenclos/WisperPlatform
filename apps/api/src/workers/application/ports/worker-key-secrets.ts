/**
 * Minting and fingerprinting of machine secrets. The domain does not draw randomness itself:
 * the entropy source is a platform concern.
 */
export interface WorkerKeySecrets {
  /** A fresh, unpredictable secret, to be shown to its owner exactly once. */
  generate(): string;
  /**
   * Stable fingerprint of the secret, the only persisted form. A plain hash is enough here, and
   * that is deliberate: the secret is 256 bits of randomness, not a password. No dictionary
   * attack is possible against such entropy, and a slow KDF would turn every work claim into an
   * expensive computation, several times per second and per machine.
   */
  fingerprint(secret: string): string;
}

export const WORKER_KEY_SECRETS = Symbol('WorkerKeySecrets');
