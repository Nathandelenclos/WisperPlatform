import { useTranslation } from '../i18n';
import { EmptyState } from './primitives';

/**
 * Main panel as long as no transcription is open. It does not merely state the emptiness: it
 * names the possible gestures and offers the first of them.
 *
 * The icon inherits its colour from the text (`currentColor`) and has no need to hide itself:
 * `EmptyState` already takes it out of the accessibility tree.
 */
export function NoSelection() {
  const { t } = useTranslation();

  return (
    <EmptyState
      icon={
        <svg viewBox="0 0 24 24" fill="currentColor">
          <rect x="2" y="10" width="2.5" height="4" rx="1.25" />
          <rect x="7" y="6" width="2.5" height="12" rx="1.25" />
          <rect x="12" y="3" width="2.5" height="18" rx="1.25" />
          <rect x="17" y="8" width="2.5" height="8" rx="1.25" />
        </svg>
      }
      title={t('noSelection.title')}
      description={t('noSelection.description')}
      action={
        <a className="text-link" href="#upload-panel">
          {t('noSelection.action')}
        </a>
      }
    />
  );
}
