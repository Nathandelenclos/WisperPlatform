import type { ReactElement } from 'react';
import { useTranslation, type MessageKey } from '../../i18n';

/**
 * Union redeclared here, identical to the domain's `TranscriptionStatus`: a visual primitive
 * does not depend on the API layer, not even through a type. It stays assignable from the
 * domain.
 */
type PillStatus = 'pending' | 'transcribing' | 'completed' | 'failed';

const LABELS: Record<PillStatus, MessageKey> = {
  pending: 'status.pending',
  transcribing: 'status.transcribing',
  completed: 'status.completed',
  failed: 'status.failed',
};

/**
 * One **shape** per status, on top of the colour and the label: empty circle (nothing has
 * started), filled disc (it is working), tick (it is done), cross (it fell over). The geometry
 * lives in the SVG, not in the stylesheet, which then has only tokens to handle.
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
 * Status pill. The status is never carried by colour alone: it is also carried by the label,
 * readable, and by a distinct shape — a colour-blind reader reads the pill without the colour.
 */
export function StatusPill({
  status,
  size = 'md',
}: {
  status: PillStatus;
  size?: 'md' | 'sm';
}): ReactElement {
  const { t } = useTranslation();

  return (
    <span className={`status-pill status-pill--${status} status-pill--${size}`}>
      <svg className="status-pill__icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
        {SHAPES[status]}
      </svg>
      {t(LABELS[status])}
    </span>
  );
}
