import type { ReactElement } from 'react';

/**
 * Union redéclarée ici, identique à `TranscriptionStatus` du domaine : une primitive visuelle
 * ne dépend pas de la couche API, même par un type. Elle reste assignable depuis le domaine.
 */
type PillStatus = 'pending' | 'transcribing' | 'completed' | 'failed';

const LABELS: Record<PillStatus, string> = {
  pending: 'En attente',
  transcribing: 'En cours',
  completed: 'Terminée',
  failed: 'Échec',
};

/**
 * Une **forme** par statut, en plus de la couleur et du libellé : cercle vide (rien n'a
 * commencé), disque plein (ça travaille), coche (c'est fait), croix (c'est tombé). La géométrie
 * vit dans le SVG, pas dans la feuille de style, qui n'a ainsi que des tokens à manipuler.
 */
const SHAPES: Record<PillStatus, ReactElement> = {
  pending: <circle cx="8" cy="8" r="5" fill="none" stroke="currentColor" strokeWidth="2" />,
  transcribing: <circle cx="8" cy="8" r="5" fill="currentColor" />,
  completed: (
    <path
      d="m3 8.5 3.5 3.5L13 5"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  ),
  failed: (
    <path
      d="M4.5 4.5l7 7m0-7-7 7"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
    />
  ),
};

/**
 * Pastille de statut. Le statut n'est jamais porté par la seule couleur : il l'est aussi par
 * le libellé, lisible, et par une forme distincte — un daltonien lit la pastille sans elle.
 */
export function StatusPill({
  status,
  size = 'md',
}: {
  status: PillStatus;
  size?: 'md' | 'sm';
}): ReactElement {
  return (
    <span className={`status-pill status-pill--${status} status-pill--${size}`}>
      <svg className="status-pill__icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
        {SHAPES[status]}
      </svg>
      {LABELS[status]}
    </span>
  );
}
