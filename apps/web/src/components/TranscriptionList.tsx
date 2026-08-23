import type { TranscriptionSummary } from '../api/transcriptions';
import { languageLabel, useTranslation, type Translate } from '../i18n';
import { EmptyState, Notice, Skeleton, StatusPill, VisuallyHidden } from './primitives';

/** Three ghost rows: enough to hold the space, not enough to look like a wait. */
const PLACEHOLDER_ROWS = [0, 1, 2];

/**
 * What the row says about progress. A running transcription announces what has already
 * arrived: without that, a wait lasting minutes is indistinguishable from a stall.
 */
function describeSegments(item: TranscriptionSummary, t: Translate): string {
  const count = item.segmentCount;
  if (item.status !== 'transcribing') return t('library.segments', { count });
  if (count === 0) return t('library.starting');
  return t('library.segmentsReceived', { count });
}

type TranscriptionListProps = {
  items: readonly TranscriptionSummary[];
  selectedId: string | null;
  loading: boolean;
  errorMessage: string | null;
  onSelect: (transcriptionId: string) => void;
};

/**
 * Library of transcriptions. This is the main navigation of the workspace: it answers “where am
 * I” (current item marked) and “where can I go” (everything is flat, one single level). The
 * selection goes back up to the container.
 */
export function TranscriptionList({
  items,
  selectedId,
  loading,
  errorMessage,
  onSelect,
}: TranscriptionListProps) {
  const { t, format } = useTranslation();
  const firstLoad = loading && items.length === 0;
  const empty = !loading && items.length === 0 && errorMessage === null;

  return (
    <nav className="library panel" aria-labelledby="library-title">
      <div className="library__head">
        <h2 className="library__title" id="library-title">
          {t('library.title')}
        </h2>
        {items.length === 0 ? null : (
          <span className="library__count">{format.number(items.length)}</span>
        )}
      </div>

      {/*
        Live region rendered permanently and empty at rest: a region created at the same time
        as its content is not announced. Error and wait take turns in it.
      */}
      <div className="library__feedback" aria-live="polite">
        {errorMessage !== null ? (
          <Notice tone="error" title={t('library.unavailableTitle')}>
            {errorMessage}
          </Notice>
        ) : firstLoad ? (
          <p className="library__loading">{t('library.loading')}</p>
        ) : null}
      </div>

      {/* The space is reserved from the first render: the list that lands pushes nothing. */}
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
          title={t('library.emptyTitle')}
          description={t('library.emptyDescription')}
          action={
            <a className="text-link" href="#upload-file">
              {t('library.emptyAction')}
            </a>
          }
        />
      ) : null}

      {items.length === 0 ? null : (
        <ul className="library__items">
          {items.map((item) => {
            const selected = item.id === selectedId;

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
                      <VisuallyHidden>{`${t('library.model')} `}</VisuallyHidden>
                      {item.model}
                    </span>
                    <span className="library__meta-item">
                      <VisuallyHidden>{`${t('library.language')} `}</VisuallyHidden>
                      {languageLabel(item.language, t)}
                    </span>
                    <time className="library__meta-item" dateTime={item.requestedAt}>
                      {format.relativeTime(item.requestedAt)}
                    </time>
                  </span>

                  <span className="library__meta">
                    {item.durationMs > 0 ? (
                      <span className="library__meta-item">
                        <VisuallyHidden>{`${t('library.duration')} `}</VisuallyHidden>
                        {format.duration(item.durationMs)}
                      </span>
                    ) : null}
                    <span className="library__meta-item">{describeSegments(item, t)}</span>
                    {/*
                      The placement is only said when it is out of the ordinary: a row waiting
                      for a machine of the owner is not waiting for the same thing as the
                      others, and without this the library would announce the same wait for two
                      different situations.
                    */}
                    {item.placement === 'owner' ? (
                      <span className="library__meta-item library__meta-item--placement">
                        <VisuallyHidden>{`${t('library.computation')} `}</VisuallyHidden>
                        {item.status === 'pending'
                          ? t('library.awaitingYourMachine')
                          : t('library.yourMachine')}
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
