import type { SubtitleFormat } from '../api/transcriptions';
import { useTranslation, type MessageKey } from '../i18n';

/**
 * Three formats, three uses. The acronym alone does not say what to choose: “SRT” or “VTT”
 * means nothing to someone who has never edited a video, so each format carries its use.
 *
 * A `null` label means the acronym is the label: SRT and VTT are format names, the same in
 * every language, and putting them in the catalogue would only invite someone to translate
 * them.
 */
const EXPORTS: readonly { format: SubtitleFormat; label: MessageKey | null; use: MessageKey }[] = [
  { format: 'srt', label: null, use: 'export.srtUse' },
  { format: 'vtt', label: null, use: 'export.vttUse' },
  { format: 'txt', label: 'export.txtLabel', use: 'export.txtUse' },
];

type ExportMenuProps = {
  buildUrl: (format: SubtitleFormat) => string;
};

/**
 * Transcript export.
 *
 * Deliberately not a dropdown menu. A menu would cost a keyboard opening, an escape key and a
 * focus trap — and a focus trap in a non-modal window is precisely what criterion 2.1.2 (no
 * keyboard trap) forbids. And the three uses, folded behind a trigger, would no longer be
 * readable at the moment of the choice. Three named, visible options in a labelled group: one
 * Tab per option, no opening, no memory to mobilise — three choices do not deserve folding.
 *
 * Each option is an `<a download>`: the target is a URL the browser downloads, not an action of
 * the application — that is the role of a link, not of a button.
 */
export function ExportMenu({ buildUrl }: ExportMenuProps) {
  const { t } = useTranslation();

  return (
    <div className="export-menu" role="group" aria-labelledby="export-menu-title">
      <h3 className="export-menu__title" id="export-menu-title">
        {t('export.title')}
      </h3>

      <ul className="export-menu__list">
        {EXPORTS.map((option) => (
          <li key={option.format}>
            <a className="export-option" href={buildUrl(option.format)} download>
              <span className="export-option__label">
                {/* Decorative: the format is already written next to it. */}
                <svg
                  className="export-option__icon"
                  viewBox="0 0 16 16"
                  aria-hidden="true"
                  focusable="false"
                >
                  <path
                    d="M8 2v7.5m0 0 3-3m-3 3-3-3M3 13h10"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
                {option.label === null ? option.format.toUpperCase() : t(option.label)}
              </span>
              <span className="export-option__use">{t(option.use)}</span>
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
