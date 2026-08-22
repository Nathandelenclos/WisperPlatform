import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { Speaker } from '../api/transcriptions';
import { formatSpeakerName } from '../format';
import { Button, Field, TextInput, VisuallyHidden } from './primitives';

/** Borne du domaine sur un nom de locuteur : le champ ne laisse pas dépasser. */
const NAME_MAX_LENGTH = 60;

type SpeakerTurnProps = {
  speaker: Speaker;
  /** Le formulaire est ouvert sur CE tour de parole — un seul à la fois dans le transcript. */
  editing: boolean;
  saving: boolean;
  /** Échec du dernier renommage. Affiché ici, là où le geste se rejoue. */
  error: string | null;
  onOpen: () => void;
  onCancel: () => void;
  onCommit: (name: string) => void;
};

/**
 * Étiquette de tour de parole, et geste de renommage.
 *
 * Elle n'est rendue qu'au CHANGEMENT de locuteur (le parent en décide) : une conversation se
 * lit en tours, répéter le même nom vingt fois de suite est du bruit.
 *
 * Le locuteur est identifié par son nom ÉCRIT, jamais par une couleur : rien ici ne dépend
 * de la perception d'une teinte (WCAG 1.4.1).
 *
 * Renommer est un geste unique et global — il vaut pour toute la transcription, pas pour ce
 * tour-ci — et le libellé du bouton le dit avant qu'on ne clique.
 */
export function SpeakerTurn({
  speaker,
  editing,
  saving,
  error,
  onOpen,
  onCancel,
  onCommit,
}: SpeakerTurnProps) {
  const display = formatSpeakerName(speaker);
  // « Locuteur 1 » n'est pas un nom qu'on a donné, c'est un rang tenu par défaut : le champ
  // s'ouvre vide et le montre en indication, sinon renommer commence toujours par effacer.
  // Un nom déjà donné, lui, se pré-remplit : on vient le corriger, pas le retaper.
  const [draft, setDraft] = useState(speaker.name ?? '');
  const [emptyRejected, setEmptyRejected] = useState(false);

  // Le formulaire s'ouvre toujours sur le nom courant, jamais sur un brouillon abandonné à
  // l'ouverture précédente. Remise à zéro pendant le rendu : la reporter à un effet ferait
  // apparaître l'ancien texte une image avant le bon.
  const [opened, setOpened] = useState(editing);
  if (opened !== editing) {
    setOpened(editing);
    if (editing) {
      setDraft(speaker.name ?? '');
      setEmptyRejected(false);
    }
  }

  const nameRef = useRef<HTMLButtonElement | null>(null);
  // Le champ disparaît avec le formulaire, et le focus retomberait sur le document : au
  // clavier, on perdrait sa place dans le transcript. Il revient donc sur le nom — mais
  // seulement si personne ne l'a repris ailleurs entre-temps.
  const wasEditing = useRef(editing);
  useEffect(() => {
    const justClosed = wasEditing.current && !editing;
    wasEditing.current = editing;
    if (justClosed && document.activeElement === document.body) nameRef.current?.focus();
  }, [editing]);

  if (!editing) {
    return (
      <p className="speaker-turn">
        <button className="speaker-turn__name" type="button" ref={nameRef} onClick={onOpen}>
          {display}
          {/* Le nom visible ouvre le nom accessible : l'effet du geste est dit en entier. */}
          <VisuallyHidden>, renommer ce locuteur dans toute la transcription</VisuallyHidden>
          <svg
            className="speaker-turn__glyph"
            viewBox="0 0 16 16"
            aria-hidden="true"
            focusable="false"
          >
            <path
              d="M10.6 2.9l2.5 2.5-7 7-3.2.7.7-3.2 7-7z"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      </p>
    );
  }

  const fieldId = `speaker-${speaker.index}-name`;

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const name = draft.trim();

    if (name.length === 0) {
      setEmptyRejected(true);
      return;
    }
    setEmptyRejected(false);

    // Le nom n'a pas changé : rien à écrire, on referme. Comparé au nom RÉEL, pas au nom
    // affiché — écrire « Locuteur 2 » sur un locuteur anonyme reste un renommage.
    if (name === speaker.name) {
      onCancel();
      return;
    }

    onCommit(name);
  };

  return (
    <form className="speaker-turn speaker-turn--editing" onSubmit={submit}>
      <Field
        id={fieldId}
        label="Nom du locuteur"
        hint={`Renommer ce locuteur dans toute la transcription, partout où ${display} parle.`}
        error={emptyRejected ? 'Un nom de locuteur ne peut pas être vide.' : error}
      >
        {(fieldProps) => (
          <TextInput
            {...fieldProps}
            className="speaker-turn__input"
            value={draft}
            placeholder={display}
            maxLength={NAME_MAX_LENGTH}
            autoComplete="off"
            /* Le champ vient d'apparaître sur demande explicite : le focus le suit, sinon
               l'utilisateur au clavier devrait retraverser la ligne pour l'atteindre. */
            autoFocus
            onChange={(changeEvent) => setDraft(changeEvent.target.value)}
            onKeyDown={(keyEvent) => {
              // Échap renonce : un formulaire ouvert dans le fil du texte doit se refermer
              // sans souris et sans quitter la ligne qu'on lisait.
              if (keyEvent.key === 'Escape') onCancel();
            }}
          />
        )}
      </Field>

      <div className="speaker-turn__actions">
        <Button type="submit" variant="primary" size="sm" loading={saving}>
          Renommer
        </Button>
        <Button type="button" size="sm" onClick={onCancel}>
          Annuler
        </Button>
      </div>
    </form>
  );
}
