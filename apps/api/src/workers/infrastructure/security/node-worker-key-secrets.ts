import { createHash, randomBytes } from 'node:crypto';

import type { WorkerKeySecrets } from '../../application/ports/worker-key-secrets';

/**
 * 256 bits of randomness. That is what allows the bare SHA-256 fingerprint on the storage side:
 * a secret with this entropy is neither guessable nor open to a dictionary attack, unlike a
 * password chosen by a human.
 */
const SECRET_BYTES = 32;

/**
 * Adapter of the `WorkerKeySecrets` port over `node:crypto`. `base64url` so that the secret
 * crosses a command line, an environment file or a header without any escaping.
 */
export class NodeWorkerKeySecrets implements WorkerKeySecrets {
  generate(): string {
    return randomBytes(SECRET_BYTES).toString('base64url');
  }

  fingerprint(secret: string): string {
    return createHash('sha256').update(secret, 'utf8').digest('hex');
  }
}
