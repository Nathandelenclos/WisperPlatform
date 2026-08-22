import type { ReactElement, ReactNode } from 'react';

type IconButtonProps = {
  /** Nom accessible du bouton : une icône seule n'en a aucun. Obligatoire, pas de défaut. */
  label: string;
  onClick?: () => void;
  children: ReactNode;
  size?: 'md' | 'sm';
  variant?: 'ghost' | 'secondary';
  disabled?: boolean;
};

/**
 * Bouton réduit à son icône. `label` devient l'`aria-label` (lecteur d'écran) et le `title`
 * (survol souris) : l'icône, elle, est masquée de l'arbre d'accessibilité par son enveloppe,
 * ce qui évite qu'un `<title>` oublié dans un SVG appelant ne pollue le nom accessible.
 *
 * En taille `sm`, le dessin se resserre mais la cible reste à 44×44 grâce au pseudo-élément
 * de `button.css` : les lignes denses du transcript restent pointables.
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
