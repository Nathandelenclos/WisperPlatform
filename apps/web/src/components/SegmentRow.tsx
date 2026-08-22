import { useState } from 'react';
import type { Segment } from '../api/transcriptions';
import { formatTimecode } from '../format';

type SegmentRowProps = {
  segment: Segment;
  /** Le segment couvre la position de lecture courante. */
  current: boolean;
  /** La correction n'est ouverte que sur une transcription terminée. */
  editable: boolean;
  saving: boolean;
  onSeek: (startMs: number) => void;
  onCommit: (text: string) => void;
};

/**
 * Une ligne de transcription : timecode cliquable et texte du segment. La correction
 * est confiée au parent au moment où le champ perd le focus, si le texte a changé ;
 * hors transcription terminée, le champ est en lecture seule.
 */
export function SegmentRow({
  segment,
  current,
  editable,
  saving,
  onSeek,
  onCommit,
}: SegmentRowProps) {
  const [draft, setDraft] = useState(segment.text);
  const [known, setKnown] = useState(segment.text);
  const [emptyRejected, setEmptyRejected] = useState(false);

  if (segment.text !== known) {
    // Le texte de référence a changé (correction enregistrée) : le brouillon suit.
    setKnown(segment.text);
    setDraft(segment.text);
    setEmptyRejected(false);
  }

  const rows = Math.min(5, Math.max(1, Math.ceil(draft.length / 64)));

  return (
    <li className={`segment${current ? ' segment--current' : ''}`} aria-current={current}>
      <button
        className="segment__timecode"
        type="button"
        onClick={() => onSeek(segment.startMs)}
        title="Écouter à partir d'ici"
      >
        {formatTimecode(segment.startMs)}
      </button>

      <div className="segment__body">
        <label className="visually-hidden" htmlFor={`segment-${segment.ordinal}`}>
          Texte du segment à {formatTimecode(segment.startMs)}
        </label>
        <textarea
          className="segment__text"
          id={`segment-${segment.ordinal}`}
          rows={rows}
          spellCheck={editable}
          readOnly={!editable}
          value={draft}
          onChange={(changeEvent) => setDraft(changeEvent.target.value)}
          onBlur={() => {
            const text = draft.trim();
            if (text.length === 0) {
              // Correction vide refusée : le champ retrouve le dernier texte accepté,
              // sinon l'utilisateur perd de vue ce qu'il était en train de corriger.
              setDraft(segment.text);
              setEmptyRejected(true);
              return;
            }
            setEmptyRejected(false);
            if (text !== segment.text) onCommit(text);
          }}
        />
        <p className="segment__state">
          {emptyRejected ? (
            <span className="segment__error" role="alert">
              Un segment ne peut pas être vide.
            </span>
          ) : null}
          {saving ? <span className="segment__saving">Enregistrement…</span> : null}
          {!saving && !emptyRejected && segment.corrected ? (
            <span className="segment__corrected">Corrigé</span>
          ) : null}
        </p>
      </div>
    </li>
  );
}
