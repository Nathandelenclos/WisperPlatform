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
 * Wrapper of a field: label **above** (never to the left, never a placeholder in its place — a
 * placeholder disappears on the first keystroke and takes the context with it), hint and error
 * tied to the control by `aria-describedby`.
 *
 * The error area is rendered permanently, empty at rest: a live region created at the same
 * time as its content is not announced, and its reserved height keeps the appearance of the
 * message from pushing the rest of the form.
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

/** Text field. The error styling follows `aria-invalid`, set by `Field`. */
export function TextInput({
  className,
  ...rest
}: InputHTMLAttributes<HTMLInputElement>): ReactElement {
  return <input {...rest} className={className ? `control ${className}` : 'control'} />;
}

/**
 * Native dropdown: it brings the keyboard, type-ahead search and the phone wheel for free. The
 * chevron is only a signifier, the original `appearance` is neutralised in `field.css`.
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
