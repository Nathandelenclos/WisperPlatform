import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { Speaker } from '../api/transcriptions';
import { useTranslation } from '../i18n';
import { Button, Field, TextInput, VisuallyHidden } from './primitives';

/** Domain bound on a speaker name: the field does not let it overflow. */
const NAME_MAX_LENGTH = 60;

type SpeakerTurnProps = {
  speaker: Speaker;
  /** The form is open on THIS turn — only one at a time in the transcript. */
  editing: boolean;
  saving: boolean;
  /** Failure of the last rename. Shown here, where the gesture is replayed. */
  error: string | null;
  onOpen: () => void;
  onCancel: () => void;
  onCommit: (name: string) => void;
};

/**
 * Speaker-turn label, and the rename gesture.
 *
 * It is only rendered on a CHANGE of speaker (the parent decides): a conversation is read in
 * turns, and repeating the same name twenty times over is noise.
 *
 * The speaker is identified by their WRITTEN name, never by a colour: nothing here depends on
 * perceiving a hue (WCAG 1.4.1).
 *
 * Renaming is a single, global gesture — it holds for the whole transcription, not for this
 * turn — and the button label says so before anyone clicks.
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
  const { t } = useTranslation();
  // “Speaker 1” is not a name anyone gave, it is a rank held by default: the field opens empty
  // and shows it as a placeholder, otherwise renaming always starts by erasing. A name already
  // given is prefilled: one comes to correct it, not to retype it.
  const display = speaker.name ?? t('speaker.fallbackName', { index: speaker.index + 1 });
  const [draft, setDraft] = useState(speaker.name ?? '');
  const [emptyRejected, setEmptyRejected] = useState(false);

  // The form always opens on the current name, never on a draft abandoned at the previous
  // opening. Reset during the render: deferring it to an effect would flash the old text one
  // frame before the right one.
  const [opened, setOpened] = useState(editing);
  if (opened !== editing) {
    setOpened(editing);
    if (editing) {
      setDraft(speaker.name ?? '');
      setEmptyRejected(false);
    }
  }

  const nameRef = useRef<HTMLButtonElement | null>(null);
  // The field disappears with the form, and the focus would fall back on the document: at the
  // keyboard, one would lose one's place in the transcript. It therefore comes back to the
  // name — but only if nobody has taken it elsewhere in the meantime.
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
          {/* The visible name opens the accessible one: the effect of the gesture is said whole. */}
          <VisuallyHidden>{t('speaker.renameHint')}</VisuallyHidden>
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

    // The name did not change: nothing to write, we close. Compared against the REAL name, not
    // the displayed one — writing “Speaker 2” on an anonymous speaker is still a rename.
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
        label={t('speaker.nameLabel')}
        hint={t('speaker.nameFieldHint', { name: display })}
        error={emptyRejected ? t('speaker.emptyRejected') : error}
      >
        {(fieldProps) => (
          <TextInput
            {...fieldProps}
            className="speaker-turn__input"
            value={draft}
            placeholder={display}
            maxLength={NAME_MAX_LENGTH}
            autoComplete="off"
            /* The field has just appeared on an explicit request: focus follows it, otherwise a
               keyboard user would have to cross the line again to reach it. */
            autoFocus
            onChange={(changeEvent) => setDraft(changeEvent.target.value)}
            onKeyDown={(keyEvent) => {
              // Escape gives up: a form opened inside the flow of the text must close without a
              // mouse and without leaving the line one was reading.
              if (keyEvent.key === 'Escape') onCancel();
            }}
          />
        )}
      </Field>

      <div className="speaker-turn__actions">
        <Button type="submit" variant="primary" size="sm" loading={saving}>
          {t('speaker.rename')}
        </Button>
        <Button type="button" size="sm" onClick={onCancel}>
          {t('speaker.cancel')}
        </Button>
      </div>
    </form>
  );
}
