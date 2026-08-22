import type { TranscriptionSummary } from '../api/transcriptions';
import { formatByteSize, formatDateTime, formatDuration } from '../format';
import { StatusBadge } from './StatusBadge';

type TranscriptionListProps = {
  items: readonly TranscriptionSummary[];
  selectedId: string | null;
  loading: boolean;
  errorMessage: string | null;
  onSelect: (transcriptionId: string) => void;
};

/** Liste des transcriptions de l'utilisateur ; la sélection remonte au parent. */
export function TranscriptionList({
  items,
  selectedId,
  loading,
  errorMessage,
  onSelect,
}: TranscriptionListProps) {
  return (
    <section className="panel" aria-labelledby="library-title">
      <h2 className="panel__title" id="library-title">
        Mes transcriptions
      </h2>

      {errorMessage === null ? null : (
        <p className="notice notice--error" role="alert">
          {errorMessage}
        </p>
      )}

      {loading && items.length === 0 ? (
        <p className="notice" role="status">
          Chargement de vos transcriptions…
        </p>
      ) : null}

      {!loading && items.length === 0 && errorMessage === null ? (
        <p className="empty">
          Aucune transcription pour l'instant. Déposez un fichier audio ou vidéo ci-dessus : les
          phrases apparaîtront ici au fil de la transcription.
        </p>
      ) : null}

      <ul className="library">
        {items.map((item) => (
          <li key={item.id}>
            <button
              className={`library__row${item.id === selectedId ? ' library__row--selected' : ''}`}
              type="button"
              aria-current={item.id === selectedId}
              onClick={() => onSelect(item.id)}
            >
              <span className="library__name">{item.mediaName}</span>
              <StatusBadge status={item.status} />
              <span className="library__meta">
                <span>{item.model}</span>
                <span aria-hidden="true">·</span>
                <span>{item.language}</span>
                <span aria-hidden="true">·</span>
                <span>{formatByteSize(item.mediaByteSize)}</span>
              </span>
              <span className="library__meta">
                <span>{formatDateTime(item.requestedAt)}</span>
                <span aria-hidden="true">·</span>
                <span>{formatDuration(item.durationMs)}</span>
                <span aria-hidden="true">·</span>
                <span>
                  {item.segmentCount} {item.segmentCount === 1 ? 'segment' : 'segments'}
                </span>
              </span>
              {item.failureReason === null ? null : (
                <span className="library__failure">{item.failureReason}</span>
              )}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
