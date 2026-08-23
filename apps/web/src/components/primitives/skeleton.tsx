import type { ReactElement } from 'react';

/**
 * Space reserved during a load. `aria-hidden`: the skeleton is scenery, and the arrival of the
 * data is announced by the live region of the screen, not by these bars.
 *
 * The pulse disappears under `prefers-reduced-motion` (see `skeleton.css`): the space stays
 * reserved, which is its real job — no layout jump when the content lands.
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
