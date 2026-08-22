import type { SubtitleFormat } from '../api/transcriptions';

/**
 * Trois formats, trois usages. Le sigle seul ne dit pas quoi choisir : « SRT » ou « VTT »
 * ne veut rien dire pour qui n'a jamais monté une vidéo, donc chaque format porte son usage.
 */
const EXPORTS: readonly { format: SubtitleFormat; label: string; use: string }[] = [
  { format: 'srt', label: 'SRT', use: 'Sous-titres, pour un lecteur ou un logiciel de montage' },
  { format: 'vtt', label: 'VTT', use: 'Sous-titres, pour un lecteur vidéo sur le web' },
  { format: 'txt', label: 'Texte brut', use: 'Le texte seul, sans timecode, à copier-coller' },
];

type ExportMenuProps = {
  buildUrl: (format: SubtitleFormat) => string;
};

/**
 * Export du transcript.
 *
 * Ce n'est volontairement pas un menu déroulant. Un menu coûterait une ouverture au clavier,
 * une touche d'échappement et un piège de focus — or un piège de focus dans une fenêtre non
 * modale est précisément ce que le critère 2.1.2 (pas de piège au clavier) proscrit. Et les
 * trois usages, repliés derrière un déclencheur, ne seraient plus lisibles au moment du
 * choix. Trois options nommées et visibles dans un groupe étiqueté : un Tab par option,
 * aucune ouverture, aucune mémoire à mobiliser — trois choix ne méritent pas d'être repliés.
 *
 * Chaque option est un `<a download>` : la cible est une URL que le navigateur télécharge,
 * pas une action de l'application — c'est le rôle du lien, pas celui d'un bouton.
 */
export function ExportMenu({ buildUrl }: ExportMenuProps) {
  return (
    <div className="export-menu" role="group" aria-labelledby="export-menu-title">
      <h3 className="export-menu__title" id="export-menu-title">
        Exporter
      </h3>

      <ul className="export-menu__list">
        {EXPORTS.map((option) => (
          <li key={option.format}>
            <a className="export-option" href={buildUrl(option.format)} download>
              <span className="export-option__label">
                {/* Décorative : le format est déjà écrit à côté. */}
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
                {option.label}
              </span>
              <span className="export-option__use">{option.use}</span>
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
