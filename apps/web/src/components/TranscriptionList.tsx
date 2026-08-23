import type { TranscriptionSummary } from '../api/transcriptions';
import { formatDuration, formatRelativeTime } from '../format';
import { EmptyState, Notice, Skeleton, StatusPill, VisuallyHidden } from './primitives';

/** Trois lignes fantômes : assez pour occuper la place, pas assez pour faire attendre. */
const PLACEHOLDER_ROWS = [0, 1, 2];

/**
 * Ce que la ligne dit de l'avancement. Une transcription en cours annonce ce qui est déjà
 * arrivé : sans ça, une attente qui dure des minutes ne se distingue pas d'un blocage.
 */
function describeSegments(item: TranscriptionSummary): string {
  const plural = item.segmentCount === 1 ? '' : 's';
  if (item.status !== 'transcribing') return `${item.segmentCount} segment${plural}`;
  if (item.segmentCount === 0) return 'transcription en cours de démarrage';
  return `${item.segmentCount} segment${plural} déjà reçu${plural}`;
}

type TranscriptionListProps = {
  items: readonly TranscriptionSummary[];
  /** Sert à nommer la langue dans celle de l'utilisateur, pas dans celle du worker. */
  languages: readonly { value: string; label: string }[];
  selectedId: string | null;
  loading: boolean;
  errorMessage: string | null;
  onSelect: (transcriptionId: string) => void;
};

/**
 * Bibliothèque des transcriptions. C'est la navigation principale de l'atelier : elle
 * répond à « où suis-je » (élément courant marqué) et « où puis-je aller » (tout est à
 * plat, un seul niveau). La sélection remonte au conteneur.
 */
export function TranscriptionList({
  items,
  languages,
  selectedId,
  loading,
  errorMessage,
  onSelect,
}: TranscriptionListProps) {
  const firstLoad = loading && items.length === 0;
  const empty = !loading && items.length === 0 && errorMessage === null;

  return (
    <nav className="library panel" aria-labelledby="library-title">
      <div className="library__head">
        <h2 className="library__title" id="library-title">
          Mes transcriptions
        </h2>
        {items.length === 0 ? null : <span className="library__count">{items.length}</span>}
      </div>

      {/*
        Région live rendue en permanence et vide au repos : une région créée en même temps
        que son contenu n'est pas annoncée. Erreur et attente y passent tour à tour.
      */}
      <div className="library__feedback" aria-live="polite">
        {errorMessage !== null ? (
          <Notice tone="error" title="Bibliothèque indisponible">
            {errorMessage}
          </Notice>
        ) : firstLoad ? (
          <p className="library__loading">Chargement de vos transcriptions…</p>
        ) : null}
      </div>

      {/* La place est réservée dès le premier rendu : la liste qui arrive ne pousse rien. */}
      {firstLoad ? (
        <ul className="library__items" aria-hidden="true">
          {PLACEHOLDER_ROWS.map((row) => (
            <li key={row}>
              <div className="library__row library__row--placeholder">
                <Skeleton lines={3} />
              </div>
            </li>
          ))}
        </ul>
      ) : null}

      {empty ? (
        <EmptyState
          title="Aucune transcription pour l'instant"
          description="Déposez un audio ou une vidéo : les phrases apparaîtront ici au fil de la transcription, et chaque transcription restera consultable ensuite."
          action={
            <a className="text-link" href="#upload-file">
              Choisir un fichier
            </a>
          }
        />
      ) : null}

      {items.length === 0 ? null : (
        <ul className="library__items">
          {items.map((item) => {
            const selected = item.id === selectedId;
            const language =
              languages.find((candidate) => candidate.value === item.language)?.label ??
              item.language;

            return (
              <li key={item.id}>
                <button
                  className="library__row"
                  type="button"
                  aria-current={selected ? 'true' : undefined}
                  onClick={() => onSelect(item.id)}
                >
                  <span className="library__row-head">
                    <span className="library__name">{item.mediaName}</span>
                    <StatusPill status={item.status} size="sm" />
                  </span>

                  <span className="library__meta">
                    <span className="library__meta-item">
                      <VisuallyHidden>Modèle </VisuallyHidden>
                      {item.model}
                    </span>
                    <span className="library__meta-item">
                      <VisuallyHidden>Langue </VisuallyHidden>
                      {language}
                    </span>
                    <time className="library__meta-item" dateTime={item.requestedAt}>
                      {formatRelativeTime(item.requestedAt)}
                    </time>
                  </span>

                  <span className="library__meta">
                    {item.durationMs > 0 ? (
                      <span className="library__meta-item">
                        <VisuallyHidden>Durée </VisuallyHidden>
                        {formatDuration(item.durationMs)}
                      </span>
                    ) : null}
                    <span className="library__meta-item">{describeSegments(item)}</span>
                    {/*
                      Le placement ne se dit que s'il sort de l'ordinaire : une ligne qui
                      attend une machine du propriétaire n'attend pas la même chose que les
                      autres, et sans ça la bibliothèque annoncerait la même attente pour
                      deux situations différentes.
                    */}
                    {item.placement === 'owner' ? (
                      <span className="library__meta-item library__meta-item--placement">
                        <VisuallyHidden>Calcul </VisuallyHidden>
                        {item.status === 'pending'
                          ? 'en attente de votre machine'
                          : 'votre machine'}
                      </span>
                    ) : null}
                  </span>

                  {item.failureReason === null ? null : (
                    <span className="library__failure">{item.failureReason}</span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </nav>
  );
}
