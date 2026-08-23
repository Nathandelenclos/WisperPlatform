import { requestJson, requestNoContent } from './http';

/**
 * Clés de machine : ce qu'un utilisateur crée pour rattacher SA machine à son compte.
 * Le secret est collé dans la commande de lancement du worker ; l'API ne le rend qu'une
 * fois, à la création, et n'en garde qu'une empreinte.
 */

/** Reflète la contrainte du domaine sur le libellé. Le serveur reste seul juge. */
export const WORKER_KEY_LABEL_MAX = 60;

/** Machine déclarée, telle que la liste la donne — jamais de secret ni d'empreinte. */
export type WorkerKey = {
  id: string;
  label: string;
  createdAt: string;
  /** Dernier appel du worker portant cette clé ; `null` tant qu'aucun ne s'est présenté. */
  lastSeenAt: string | null;
  /** Date de révocation ; `null` tant que la clé sert. */
  revokedAt: string | null;
};

/**
 * Réponse de la création. `secret` n'apparaît QUE là : il n'est stocké nulle part en clair,
 * ni côté serveur, ni dans le cache du client — la vue le garde le temps qu'on le copie.
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

/** Révoque une clé. La machine reste listée, marquée révoquée : son historique compte. */
export async function revokeWorkerKey(p: { id: string }): Promise<void> {
  await requestNoContent(`/api/worker-keys/${encodeURIComponent(p.id)}`, { method: 'DELETE' });
}

/**
 * Commande de lancement prête à coller. L'origine est celle de la page : le worker doit
 * joindre la même API que le navigateur, et la deviner serait une source d'erreur de plus.
 *
 * Une seule ligne, et une image publiée : personne ne prête un cœur de processeur au prix d'un
 * clone et d'un build de trois gigaoctets. Le tag `latest` suit la branche par défaut, publié
 * par la CI après le scan de vulnérabilités.
 */
export function workerRunCommand(p: { origin: string; secret: string }): string {
  return [
    'docker run --rm',
    `-e WISPER_API_URL=${p.origin}`,
    `-e WISPER_WORKER_TOKEN=${p.secret}`,
    'ghcr.io/nathandelenclos/wisper-worker:latest',
  ].join(' ');
}
