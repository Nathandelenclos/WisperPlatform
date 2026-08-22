import type { ButtonHTMLAttributes, MouseEvent, ReactElement, ReactNode } from 'react';
import { VisuallyHidden } from './visually-hidden';

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'md' | 'sm';
  loading?: boolean;
  iconLeft?: ReactNode;
};

/**
 * Anneau d'attente. Décoratif : l'occupation est portée par `aria-busy` et par le suffixe
 * masqué du libellé. Sous `prefers-reduced-motion`, la rotation tombe et l'arc reste lisible
 * comme un signe fixe — l'information n'a jamais dépendu du mouvement.
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
 * Bouton d'action. Le défaut est `secondary` : une seule action contrastée par écran, donc
 * `primary` se demande explicitement.
 *
 * `loading` ne désactive pas le bouton — un contrôle qui disparaît de l'ordre de tabulation au
 * moment où l'utilisateur attend le retour est un piège clavier. Il reste focusable, annonce
 * son occupation, et absorbe le clic pour interdire la double soumission.
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
      {loading ? <VisuallyHidden>, en cours</VisuallyHidden> : null}
    </button>
  );
}
