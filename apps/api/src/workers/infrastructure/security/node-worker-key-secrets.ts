import { createHash, randomBytes } from 'node:crypto';

import type { WorkerKeySecrets } from '../../application/ports/worker-key-secrets';

/**
 * 256 bits d'aléa. C'est ce qui autorise l'empreinte SHA-256 nue côté stockage : un secret de
 * cette entropie n'est ni devinable ni attaquable par dictionnaire, contrairement à un mot de
 * passe choisi par un humain.
 */
const SECRET_BYTES = 32;

/**
 * Adaptateur du port `WorkerKeySecrets` sur `node:crypto`. `base64url` pour que le secret
 * traverse sans échappement une ligne de commande, un fichier d'environnement ou un en-tête.
 */
export class NodeWorkerKeySecrets implements WorkerKeySecrets {
  generate(): string {
    return randomBytes(SECRET_BYTES).toString('base64url');
  }

  fingerprint(secret: string): string {
    return createHash('sha256').update(secret, 'utf8').digest('hex');
  }
}
