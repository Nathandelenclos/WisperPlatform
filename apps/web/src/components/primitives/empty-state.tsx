import type { ReactElement, ReactNode } from 'react';

type EmptyStateProps = {
  title: string;
  description: string;
  action?: ReactNode;
  icon?: ReactNode;
};

/**
 * Zone de données vide. Elle **oriente** au lieu de constater : un titre, une phrase qui dit
 * quoi faire, et de préférence l'action qui le fait. Un « rien à afficher » sec est un écran
 * inachevé.
 *
 * Le titre est un paragraphe : le composant s'insère dans une liste comme dans un panneau sans
 * connaître le niveau de titre de son hôte, donc sans risquer un saut de hiérarchie.
 */
export function EmptyState({ title, description, action, icon }: EmptyStateProps): ReactElement {
  return (
    <div className="empty-state">
      {icon ? (
        <span className="empty-state__icon" aria-hidden="true">
          {icon}
        </span>
      ) : null}
      <p className="empty-state__title">{title}</p>
      <p className="empty-state__description">{description}</p>
      {action ? <div className="empty-state__action">{action}</div> : null}
    </div>
  );
}
