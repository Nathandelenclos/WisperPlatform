import { UnsupportedPlacementError } from './errors';

/**
 * Où une transcription doit être calculée :
 * - `service` : les workers de la plateforme ;
 * - `owner` : les machines déclarées par le propriétaire de la demande.
 *
 * Il n'y a jamais de bascule automatique d'un placement à l'autre. Une demande placée sur la
 * machine de son propriétaire attend cette machine, aussi longtemps qu'il le faut : c'est lui
 * qui décide de la rendre au service, personne d'autre.
 */
export const PLACEMENTS = ['service', 'owner'] as const;
export type Placement = (typeof PLACEMENTS)[number];

/** Par défaut, la plateforme calcule : c'est le service rendu, machine ou pas. */
export const DEFAULT_PLACEMENT: Placement = 'service';

function isPlacement(candidate: string): candidate is Placement {
  return (PLACEMENTS as readonly string[]).includes(candidate);
}

/** Frontière de confiance : un placement vient d'un corps de requête, jamais du code. */
export function toPlacement(raw: string): Placement {
  if (!isPlacement(raw)) {
    throw new UnsupportedPlacementError(`placement inconnu : ${raw}`);
  }
  return raw;
}
