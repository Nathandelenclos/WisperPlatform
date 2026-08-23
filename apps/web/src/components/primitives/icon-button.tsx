import type { ReactElement, ReactNode } from 'react';

type IconButtonProps = {
  /** Accessible name of the button: an icon alone has none. Required, no default. */
  label: string;
  onClick?: () => void;
  children: ReactNode;
  size?: 'md' | 'sm';
  variant?: 'ghost' | 'secondary';
  disabled?: boolean;
};

/**
 * A button reduced to its icon. `label` becomes the `aria-label` (screen reader) and the
 * `title` (mouse hover): the icon itself is hidden from the accessibility tree by its wrapper,
 * which prevents a `<title>` forgotten inside a calling SVG from polluting the accessible name.
 *
 * At size `sm` the drawing tightens but the target stays 44×44, thanks to the pseudo-element in
 * `button.css`: the dense lines of the transcript stay pointable.
 */
export function IconButton({
  label,
  onClick,
  children,
  size = 'md',
  variant = 'ghost',
  disabled = false,
}: IconButtonProps): ReactElement {
  return (
    <button
      type="button"
      className={`icon-button icon-button--${variant} icon-button--${size}`}
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
    >
      <span className="icon-button__glyph" aria-hidden="true">
        {children}
      </span>
    </button>
  );
}
