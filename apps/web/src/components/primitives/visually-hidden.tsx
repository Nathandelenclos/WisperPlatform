import type { ReactElement, ReactNode } from 'react';

/**
 * Texte destiné aux seuls lecteurs d'écran. Il reste dans l'arbre d'accessibilité — la classe
 * du socle le masque par découpe, jamais par `display: none` qui l'en retirerait.
 */
export function VisuallyHidden({ children }: { children: ReactNode }): ReactElement {
  return <span className="visually-hidden">{children}</span>;
}
