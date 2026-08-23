import type { WorkerKeyState } from '../domain/worker-key';

/**
 * Ce que le propriétaire voit d'une de ses machines. Ni le secret ni son empreinte : le
 * premier n'existe qu'une fois, la seconde ne regarde personne.
 */
export type WorkerKeyView = {
  id: string;
  label: string;
  createdAt: Date;
  lastSeenAt: Date | null;
  revokedAt: Date | null;
};

/**
 * Réponse à la déclaration d'une machine : la vue habituelle, plus le secret en clair.
 * C'est le SEUL endroit du système où il apparaît.
 */
export type RegisteredWorkerKeyView = WorkerKeyView & { secret: string };

/**
 * Projection de l'aggregate vers ce que le propriétaire voit. Elle vit ici, en un seul
 * endroit : deux use cases rendent cette vue, et ils doivent rendre exactement la même.
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
