import type { ReactElement, ReactNode } from 'react';

type EmptyStateProps = {
  title: string;
  description: string;
  action?: ReactNode;
  icon?: ReactNode;
};

/**
 * An empty data area. It **directs** instead of merely stating: a title, a sentence saying what
 * to do, and preferably the action that does it. A blunt “nothing to show” is an unfinished
 * screen.
 *
 * The title is a paragraph: the component slots into a list as into a panel without knowing the
 * heading level of its host, hence without risking a break in the heading hierarchy.
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
