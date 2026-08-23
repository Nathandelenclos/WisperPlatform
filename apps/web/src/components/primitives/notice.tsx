import type { ReactElement, ReactNode } from 'react';
import { useTranslation, type MessageKey } from '../../i18n';
import { VisuallyHidden } from './visually-hidden';

type NoticeTone = 'info' | 'warning' | 'error' | 'success';

/** The tone is named for the screen reader: colour says nothing to whoever cannot see it. */
const TONE_PREFIX: Record<NoticeTone, MessageKey> = {
  info: 'notice.info',
  warning: 'notice.warning',
  error: 'notice.error',
  success: 'notice.success',
};

/** One outline per tone — circle, triangle, diamond, ticked circle. */
const TONE_SHAPE: Record<NoticeTone, ReactElement> = {
  info: (
    <>
      <circle cx="10" cy="10" r="8" />
      <path d="M10 9.5v5" />
      <path d="M10 6.2h.01" />
    </>
  ),
  warning: (
    <>
      <path d="M10 2.5 18.5 17.5H1.5z" />
      <path d="M10 8v4" />
      <path d="M10 15.2h.01" />
    </>
  ),
  error: (
    <>
      <path d="M10 1.8 18.2 10 10 18.2 1.8 10z" />
      <path d="m7.4 7.4 5.2 5.2m0-5.2-5.2 5.2" />
    </>
  ),
  success: (
    <>
      <circle cx="10" cy="10" r="8" />
      <path d="m6.2 10.4 2.6 2.6 5-5.4" />
    </>
  ),
};

type NoticeProps = {
  tone: NoticeTone;
  title?: string;
  children: ReactNode;
  action?: ReactNode;
};

/**
 * Contextual message. Deliberately **mute** on the announcement side: no `role="alert"`, no
 * `aria-live`. The container owns its live region, otherwise the same sentence is announced
 * twice.
 *
 * The title is a paragraph, not a heading element: a `Notice` can live anywhere and has no
 * business knowing the heading level of its host in order to avoid creating a break.
 */
export function Notice({ tone, title, children, action }: NoticeProps): ReactElement {
  const { t } = useTranslation();
  const prefix = <VisuallyHidden>{`${t(TONE_PREFIX[tone])} `}</VisuallyHidden>;

  return (
    <div className={`notice notice--${tone}`}>
      <svg
        className="notice__icon"
        viewBox="0 0 20 20"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        focusable="false"
      >
        {TONE_SHAPE[tone]}
      </svg>

      <div className="notice__body">
        {title ? (
          <p className="notice__title">
            {prefix}
            {title}
          </p>
        ) : (
          prefix
        )}
        <div className="notice__content">{children}</div>
      </div>

      {action ? <div className="notice__action">{action}</div> : null}
    </div>
  );
}
