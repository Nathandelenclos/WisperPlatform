import type { WorkerKey } from '../../domain/worker-key';

/**
 * Dépôt de l'aggregate `WorkerKey`. `save` écrit la clé entière : elle tient dans une ligne,
 * il n'y a rien à assembler.
 *
 * `findBySecretFingerprint` est le chemin d'authentification d'une machine : il rend la clé
 * même révoquée, parce que c'est le domaine — et lui seul — qui décide ce qu'une révocation
 * empêche.
 */
export interface WorkerKeyRepository {
  save(key: WorkerKey): Promise<void>;
  findById(id: string): Promise<WorkerKey | null>;
  findBySecretFingerprint(fingerprint: string): Promise<WorkerKey | null>;
  /** Les clés d'un propriétaire, de la plus récente à la plus ancienne, révoquées comprises. */
  listOwnedBy(ownerId: string): Promise<WorkerKey[]>;
}

export const WORKER_KEY_REPOSITORY = Symbol('WorkerKeyRepository');
