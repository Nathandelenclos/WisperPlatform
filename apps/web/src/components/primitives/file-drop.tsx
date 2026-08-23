import { useEffect, useRef, useState } from 'react';
import type { ChangeEvent, DragEvent, ReactElement } from 'react';
import { useTranslation } from '../../i18n';
import { Button } from './button';

type FileDropProps = {
  /** Set on the real `<input type="file">`: an `#id` anchor therefore lands the focus on it. */
  id: string;
  file: File | null;
  onFile: (file: File | null) => void;
  accept?: string;
  /** Maximum size announced in plain words. Serves as a hint, tied by `aria-describedby`. */
  maxLabel: string;
  error?: string | null;
  disabled?: boolean;
};

/**
 * File drop. The real control is a **native** `<input type="file">`: it brings the keyboard,
 * the system picker and form validation. It is hidden by clipping and not by `display: none`,
 * which would remove it from the tab order; the focus ring is carried over to the visible zone
 * by `file-drop.css`.
 *
 * Drag and drop is only a shortcut for the mouse: everything can be done with the keyboard
 * alone, the label being tied to the input.
 */
export function FileDrop({
  id,
  file,
  onFile,
  accept,
  maxLabel,
  error = null,
  disabled = false,
}: FileDropProps): ReactElement {
  const { t, format } = useTranslation();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  /*
   * The container may reset the selection (upload accepted). Without putting the input back in
   * agreement, it keeps its old value and choosing the same file again would emit no `change`.
   */
  useEffect(() => {
    if (file === null && inputRef.current !== null) inputRef.current.value = '';
  }, [file]);

  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = error ? `${hintId} ${errorId}` : hintId;

  const handleChange = (event: ChangeEvent<HTMLInputElement>): void => {
    onFile(event.currentTarget.files?.item(0) ?? null);
  };

  const handleDragOver = (event: DragEvent<HTMLElement>): void => {
    if (disabled) return;
    // Without refusing the default behaviour, the browser opens the file instead of dropping it.
    event.preventDefault();
    setDragging(true);
  };

  const handleDragLeave = (event: DragEvent<HTMLElement>): void => {
    // Moving over a child emits a `dragleave`: we only leave when the target is outside.
    const next = event.relatedTarget;
    if (next instanceof Node && event.currentTarget.contains(next)) return;
    setDragging(false);
  };

  const handleDrop = (event: DragEvent<HTMLElement>): void => {
    event.preventDefault();
    setDragging(false);
    if (disabled) return;

    const dropped = event.dataTransfer.files.item(0);
    if (dropped === null) return;

    // The list is copied into the native input: the form stays the source of truth.
    if (inputRef.current !== null) inputRef.current.files = event.dataTransfer.files;
    onFile(dropped);
  };

  const handleRemove = (): void => {
    if (inputRef.current !== null) {
      inputRef.current.value = '';
      // The button disappears with the selection: focus goes back to the control, not to nothing.
      inputRef.current.focus();
    }
    onFile(null);
  };

  const classes = ['file-drop'];
  if (dragging) classes.push('file-drop--dragging');
  if (error) classes.push('file-drop--invalid');
  if (disabled) classes.push('file-drop--disabled');

  return (
    <div className={classes.join(' ')}>
      <input
        ref={inputRef}
        id={id}
        className="visually-hidden file-drop__input"
        type="file"
        accept={accept}
        disabled={disabled}
        aria-describedby={describedBy}
        aria-invalid={error ? true : undefined}
        onChange={handleChange}
      />

      <label
        className="file-drop__zone"
        htmlFor={id}
        onDragEnter={handleDragOver}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <svg
          className="file-drop__glyph"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          focusable="false"
        >
          <path d="M12 16V4m0 0L7.5 8.5M12 4l4.5 4.5" />
          <path d="M4 15v3.5A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5V15" />
        </svg>
        <span className="file-drop__lead">{t('fileDrop.lead')}</span>
        <span className="file-drop__cue">{t('fileDrop.cue')}</span>
      </label>

      <p className="file-drop__hint" id={hintId}>
        {maxLabel}
      </p>

      <div className="file-drop__selection">
        <p className="file-drop__chosen" aria-live="polite">
          {file === null
            ? t('fileDrop.none')
            : t('fileDrop.chosen', { name: file.name, size: format.byteSize(file.size) })}
        </p>
        {file === null ? null : (
          <Button variant="ghost" size="sm" onClick={handleRemove} disabled={disabled}>
            {t('fileDrop.remove')}
          </Button>
        )}
      </div>

      <p className="file-drop__error" id={errorId} aria-live="polite">
        {error ?? ''}
      </p>
    </div>
  );
}
