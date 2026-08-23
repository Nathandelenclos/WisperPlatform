import type { ButtonHTMLAttributes, MouseEvent, ReactElement, ReactNode } from 'react';
import { useTranslation } from '../../i18n';
import { VisuallyHidden } from './visually-hidden';

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'md' | 'sm';
  loading?: boolean;
  iconLeft?: ReactNode;
};

/**
 * Waiting ring. Decorative: the busy state is carried by `aria-busy` and by the hidden suffix
 * of the label. Under `prefers-reduced-motion` the rotation drops and the arc stays readable
 * as a fixed sign — the information never depended on the movement.
 */
function Spinner(): ReactElement {
  return (
    <svg
      className="button__spinner"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M8 1.5A6.5 6.5 0 0 1 14.5 8" />
    </svg>
  );
}

/**
 * Action button. The default is `secondary`: one contrasted action per screen, so `primary` is
 * asked for explicitly.
 *
 * `loading` does not disable the button — a control that leaves the tab order at the very
 * moment the user is waiting for an answer is a keyboard trap. It stays focusable, announces
 * its busy state, and swallows the click to forbid a double submission.
 */
export function Button({
  variant = 'secondary',
  size = 'md',
  loading = false,
  iconLeft,
  children,
  className,
  disabled = false,
  type = 'button',
  onClick,
  ...rest
}: ButtonProps): ReactElement {
  const { t } = useTranslation();

  const handleClick = (event: MouseEvent<HTMLButtonElement>): void => {
    if (loading) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    onClick?.(event);
  };

  const classes = ['button', `button--${variant}`, `button--${size}`];
  if (loading) classes.push('button--loading');
  if (className) classes.push(className);

  return (
    <button
      {...rest}
      type={type}
      className={classes.join(' ')}
      disabled={disabled}
      aria-disabled={loading || undefined}
      aria-busy={loading || undefined}
      onClick={handleClick}
    >
      {loading ? <Spinner /> : null}
      {!loading && iconLeft ? (
        <span className="button__icon" aria-hidden="true">
          {iconLeft}
        </span>
      ) : null}
      <span className="button__label">{children}</span>
      {loading ? <VisuallyHidden>{t('button.busy')}</VisuallyHidden> : null}
    </button>
  );
}
