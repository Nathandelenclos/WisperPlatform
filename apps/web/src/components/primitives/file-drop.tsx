import { useEffect, useRef, useState } from 'react';
import type { ChangeEvent, DragEvent, ReactElement } from 'react';
import { formatByteSize } from '../../format';
import { Button } from './button';

type FileDropProps = {
  /** Posé sur l'`<input type="file">` réel : une ancre `#id` y amène donc bien le focus. */
  id: string;
  file: File | null;
  onFile: (file: File | null) => void;
  accept?: string;
  /** Taille maximale annoncée, en clair. Sert d'aide, reliée par `aria-describedby`. */
  maxLabel: string;
  error?: string | null;
  disabled?: boolean;
};

/**
 * Dépôt de fichier. Le contrôle est un `<input type="file">` **natif** : il apporte le clavier,
 * le sélecteur du système et la validation du formulaire. Il est masqué par découpe et non par
 * `display: none`, qui le retirerait de l'ordre de tabulation ; l'anneau de focus est reporté
 * sur la zone visible par `file-drop.css`.
 *
 * Le glisser-déposer n'est qu'un raccourci pour la souris : tout se fait aussi au clavier seul,
 * l'étiquette étant liée à l'input.
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
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  /*
   * Le conteneur peut remettre la sélection à zéro (envoi accepté). Sans cette remise en
   * cohérence, l'input garde son ancienne valeur et rechoisir le même fichier n'émettrait
   * aucun `change`.
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
    // Sans ce refus du comportement par défaut, le navigateur ouvre le fichier au lieu de le déposer.
    event.preventDefault();
    setDragging(true);
  };

  const handleDragLeave = (event: DragEvent<HTMLElement>): void => {
    // Passer au-dessus d'un enfant émet un `dragleave` : on ne quitte que si la cible est dehors.
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

    // On recopie la liste dans l'input natif : le formulaire reste la source de vérité.
    if (inputRef.current !== null) inputRef.current.files = event.dataTransfer.files;
    onFile(dropped);
  };

  const handleRemove = (): void => {
    if (inputRef.current !== null) {
      inputRef.current.value = '';
      // Le bouton disparaît avec la sélection : on rend le focus au contrôle plutôt qu'au vide.
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
        <span className="file-drop__lead">Déposez un fichier audio ou vidéo</span>
        <span className="file-drop__cue">ou parcourez vos fichiers</span>
      </label>

      <p className="file-drop__hint" id={hintId}>
        {maxLabel}
      </p>

      <div className="file-drop__selection">
        <p className="file-drop__chosen" aria-live="polite">
          {file === null
            ? 'Aucun fichier choisi'
            : `Fichier choisi : ${file.name} (${formatByteSize(file.size)})`}
        </p>
        {file === null ? null : (
          <Button variant="ghost" size="sm" onClick={handleRemove} disabled={disabled}>
            Retirer
          </Button>
        )}
      </div>

      <p className="file-drop__error" id={errorId} aria-live="polite">
        {error ?? ''}
      </p>
    </div>
  );
}
