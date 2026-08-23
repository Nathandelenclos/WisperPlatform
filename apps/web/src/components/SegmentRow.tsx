import { useState, type ReactNode } from 'react';
import type { Segment } from '../api/transcriptions';
import { formatTimecode } from '../format';
import { useTranslation } from '../i18n';
import { VisuallyHidden } from './primitives';

/*
 * The callbacks receive the ordinal of the segment instead of being closed over by the parent:
 * a transcript can hold thousands of lines, and one function per line per render is pure
 * allocation. Here the parent passes three references, once and for all.
 */
type SegmentRowProps = {
  segment: Segment;
  /**
   * Speaker label, when this segment opens a turn. The parent decides: it alone sees the
   * previous line, and the label does not repeat itself from one line to the next.
   */
  speakerHead: ReactNode;
  /** The segment covers the current playback position. */
  current: boolean;
  /** Correcting is only open on a finished transcription. */
  editable: boolean;
  saving: boolean;
  onSeek: (startMs: number) => void;
  onCommit: (ordinal: number, text: string) => void;
  /** The field takes or gives back the focus: the parent suspends automatic scrolling. */
  onEditingChange: (editing: boolean) => void;
};

/**
 * One transcript line: clickable timecode and segment text. The correction is handed to the
 * parent when the field loses focus, if the text changed; outside a finished transcription the
 * field is read-only.
 *
 * The field grows with its content without any measurement in JavaScript: the container
 * duplicates the text in a superimposed pseudo-element (`data-replicated-value`), and it is
 * that invisible twin which gives the grid its height. No internal scrolling, no layout
 * computation triggered on each keystroke.
 */
export function SegmentRow({
  segment,
  speakerHead,
  current,
  editable,
  saving,
  onSeek,
  onCommit,
  onEditingChange,
}: SegmentRowProps) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState(segment.text);
  const [known, setKnown] = useState(segment.text);
  const [editing, setEditing] = useState(false);
  const [emptyRejected, setEmptyRejected] = useState(false);

  // The reference text changed (correction saved, batch replayed, stream resynchronised): the
  // draft follows. Never while editing — nothing moves under the cursor; the arbitration is
  // deferred to the blur, where what the user typed keeps priority.
  if (!editing && segment.text !== known) {
    setKnown(segment.text);
    setDraft(segment.text);
    setEmptyRejected(false);
  }

  const clock = formatTimecode(segment.startMs);
  const fieldId = `segment-${segment.ordinal}`;
  const stateId = `${fieldId}-state`;

  const commit = () => {
    setEditing(false);
    onEditingChange(false);
    const text = draft.trim();

    if (text.length === 0) {
      // Empty correction refused: the field goes back to the last accepted text, otherwise the
      // user loses sight of what they were correcting.
      setDraft(segment.text);
      setKnown(segment.text);
      setEmptyRejected(true);
      return;
    }

    setEmptyRejected(false);

    if (text === known) {
      // Nothing new was typed. If the reference moved during the edit, we adopt it now rather
      // than writing over a version more recent than ours.
      setDraft(segment.text);
      setKnown(segment.text);
      return;
    }

    setDraft(text);
    if (text !== segment.text) onCommit(segment.ordinal, text);
  };

  return (
    <li
      className={`segment${current ? ' segment--current' : ''}`}
      data-ordinal={segment.ordinal}
      aria-current={current ? 'location' : undefined}
    >
      {/* The speaker turn caps the whole line, timecode included. */}
      {speakerHead}

      <button className="segment__timecode" type="button" onClick={() => onSeek(segment.startMs)}>
        {/* The visible timecode acts as the label; the screen reader hears the gesture. */}
        <VisuallyHidden>{`${t('segment.playFrom')} `}</VisuallyHidden>
        <span className="segment__clock">{clock}</span>
      </button>

      <div className="segment__body">
        {/*
         * One visible label per line would be a wall of text: the neighbouring timecode plays
         * that role for the eye, and the tied label — hidden — names the field for assistive
         * technology.
         */}
        <label className="visually-hidden" htmlFor={fieldId}>
          {t('segment.textLabel', { at: clock })}
        </label>

        <div className="segment__grow" data-replicated-value={draft}>
          <textarea
            className="segment__text"
            id={fieldId}
            rows={1}
            spellCheck={editable}
            readOnly={!editable}
            aria-describedby={stateId}
            aria-invalid={emptyRejected ? true : undefined}
            value={draft}
            onChange={(changeEvent) => setDraft(changeEvent.target.value)}
            onFocus={() => {
              setEditing(true);
              onEditingChange(true);
            }}
            onBlur={commit}
          />
        </div>

        {/*
         * State line always present: its height is reserved, so the appearance of “Saving…”
         * then of “Corrected” never shifts the rest of the transcript.
         */}
        <p className="segment__state" id={stateId}>
          {current ? <VisuallyHidden>{t('segment.playing')}</VisuallyHidden> : null}
          {emptyRejected ? (
            <span className="segment__error" role="alert">
              {t('segment.emptyRejected')}
            </span>
          ) : null}
          {saving ? <span className="segment__saving">{t('segment.saving')}</span> : null}
          {!saving && !emptyRejected && segment.corrected ? (
            <span className="segment__corrected">{t('segment.corrected')}</span>
          ) : null}
        </p>
      </div>
    </li>
  );
}
