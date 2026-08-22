import type { TranscriptionStatus } from '../api/transcriptions';

/** Le statut est porté par le libellé autant que par la couleur. */
const STATUS_LABELS: Record<TranscriptionStatus, string> = {
  pending: 'En attente',
  transcribing: 'En cours',
  completed: 'Terminée',
  failed: 'Échec',
};

export function StatusBadge({ status }: { status: TranscriptionStatus }) {
  return (
    <span className={`badge badge--${status}`}>
      <span className="badge__dot" aria-hidden="true" />
      {STATUS_LABELS[status]}
    </span>
  );
}
