import type { ReactElement } from 'react';

/**
 * Réservation d'espace pendant un chargement. `aria-hidden` : le squelette est un décor, et
 * l'arrivée des données est annoncée par la région live de l'écran, pas par ces barres.
 *
 * Le pouls disparaît sous `prefers-reduced-motion` (cf. `skeleton.css`) : la place reste
 * réservée, ce qui est sa vraie fonction — pas de saut de mise en page à l'arrivée du contenu.
 */
export function Skeleton({ lines = 3, width }: { lines?: number; width?: string }): ReactElement {
  const count = Math.max(1, Math.trunc(lines));

  return (
    <div className="skeleton" style={width === undefined ? undefined : { width }} aria-hidden="true">
      {Array.from({ length: count }, (_unused, index) => (
        <span className="skeleton__line" key={index} />
      ))}
    </div>
  );
}
