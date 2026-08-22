import type {
  InputHTMLAttributes,
  ReactElement,
  ReactNode,
  SelectHTMLAttributes,
} from 'react';

type FieldRenderProps = {
  id: string;
  'aria-describedby'?: string;
  'aria-invalid'?: boolean;
};

type FieldProps = {
  id: string;
  label: string;
  hint?: string;
  error?: string | null;
  children: (fieldProps: FieldRenderProps) => ReactNode;
};

/**
 * Enveloppe d'un champ : label **au-dessus** (jamais à gauche, jamais un placeholder à sa
 * place — un placeholder disparaît à la frappe et le contexte avec lui), aide et erreur
 * reliées au contrôle par `aria-describedby`.
 *
 * La zone d'erreur est rendue en permanence, vide au repos : une région live créée en même
 * temps que son contenu n'est pas annoncée, et sa hauteur réservée évite que l'apparition du
 * message ne pousse le reste du formulaire.
 */
export function Field({ id, label, hint, error, children }: FieldProps): ReactElement {
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = [hint ? hintId : null, error ? errorId : null]
    .filter((value): value is string => value !== null)
    .join(' ');

  return (
    <div className={error ? 'field field--invalid' : 'field'}>
      <label className="field__label" htmlFor={id}>
        {label}
      </label>

      {hint ? (
        <p className="field__hint" id={hintId}>
          {hint}
        </p>
      ) : null}

      {children({
        id,
        'aria-describedby': describedBy === '' ? undefined : describedBy,
        'aria-invalid': error ? true : undefined,
      })}

      <p className="field__error" id={errorId} aria-live="polite">
        {error ?? ''}
      </p>
    </div>
  );
}

/** Champ texte. Le style d'erreur suit `aria-invalid`, posé par `Field`. */
export function TextInput({
  className,
  ...rest
}: InputHTMLAttributes<HTMLInputElement>): ReactElement {
  return <input {...rest} className={className ? `control ${className}` : 'control'} />;
}

/**
 * Liste déroulante native : elle apporte gratuitement le clavier, la recherche à la frappe et
 * la roulette du téléphone. Le chevron n'est qu'un signifiant, l'`appearance` d'origine est
 * neutralisée dans `field.css`.
 */
export function Select({
  className,
  children,
  ...rest
}: SelectHTMLAttributes<HTMLSelectElement>): ReactElement {
  return (
    <span className="control-shell">
      <select
        {...rest}
        className={className ? `control control--select ${className}` : 'control control--select'}
      >
        {children}
      </select>
      <svg
        className="control-shell__chevron"
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        focusable="false"
      >
        <path d="m4 6.5 4 4 4-4" />
      </svg>
    </span>
  );
}
