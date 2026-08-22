import type { ReactElement, ReactNode } from 'react';
import { VisuallyHidden } from './visually-hidden';

type NoticeTone = 'info' | 'warning' | 'error' | 'success';

/** Le ton est nommé pour le lecteur d'écran : la couleur ne dit rien à qui ne la voit pas. */
const TONE_PREFIX: Record<NoticeTone, string> = {
  info: 'Information',
  warning: 'Attention',
  error: 'Erreur',
  success: 'Succès',
};

/** Un contour différent par ton — cercle, triangle, losange, cercle coché. */
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
 * Message contextuel. Volontairement **muet** côté annonce : ni `role="alert"`, ni `aria-live`.
 * C'est le conteneur qui possède sa région live, sinon la même phrase est annoncée deux fois.
 *
 * Le titre est un paragraphe, pas un élément de titre : un `Notice` peut vivre n'importe où et
 * n'a pas à connaître le niveau de titre de son hôte pour ne pas créer de saut.
 */
export function Notice({ tone, title, children, action }: NoticeProps): ReactElement {
  const prefix = <VisuallyHidden>{`${TONE_PREFIX[tone]} : `}</VisuallyHidden>;

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
