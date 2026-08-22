import { EmptyState } from './primitives';

/**
 * Panneau principal tant qu'aucune transcription n'est ouverte. Il ne se contente pas de
 * constater le vide : il nomme les gestes possibles et propose le premier d'entre eux.
 *
 * L'icône hérite sa couleur du texte (`currentColor`) et n'a pas à se cacher elle-même :
 * `EmptyState` la sort déjà de l'arbre d'accessibilité.
 */
export function NoSelection() {
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
      title="Aucune transcription ouverte"
      description="Choisissez une transcription dans la bibliothèque pour lire le média, corriger le texte et l'exporter."
      action={
        <a className="text-link" href="#upload-panel">
          Déposer un média
        </a>
      }
    />
  );
}
