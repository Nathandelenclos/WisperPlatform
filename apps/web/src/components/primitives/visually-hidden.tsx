import type { ReactElement, ReactNode } from 'react';

/**
 * Text meant for screen readers only. It stays in the accessibility tree — the base stylesheet
 * hides it by clipping, never by `display: none`, which would remove it from that tree.
 */
export function VisuallyHidden({ children }: { children: ReactNode }): ReactElement {
  return <span className="visually-hidden">{children}</span>;
}
