import { useState, type ReactNode } from 'react';
import type { Segment } from '../api/transcriptions';
import { formatTimecode } from '../format';
import { VisuallyHidden } from './primitives';

/*
 * Les callbacks reçoivent l'ordinal du segment au lieu d'être refermés dessus par le parent :
 * un transcript peut compter des milliers de lignes, et une fonction par ligne et par rendu
 * est de l'allocation pure. Ici le parent passe trois références, une fois pour toutes.
 */
type SegmentRowProps = {
  segment: Segment;
  /**
   * Étiquette du locuteur, quand ce segment ouvre un tour de parole. Le parent tranche : lui
   * seul voit la ligne précédente, et l'étiquette ne se répète pas d'une ligne à l'autre.
   */
  speakerHead: ReactNode;
  /** Le segment couvre la position de lecture courante. */
  current: boolean;
  /** La correction n'est ouverte que sur une transcription terminée. */
  editable: boolean;
  saving: boolean;
  onSeek: (startMs: number) => void;
  onCommit: (ordinal: number, text: string) => void;
  /** Le champ prend ou rend le focus : le parent suspend le défilement automatique. */
  onEditingChange: (editing: boolean) => void;
};

/**
 * Une ligne de transcription : timecode cliquable et texte du segment. La correction
 * est confiée au parent au moment où le champ perd le focus, si le texte a changé ;
 * hors transcription terminée, le champ est en lecture seule.
 *
 * Le champ s'agrandit avec son contenu sans mesure en JavaScript : le conteneur duplique
 * le texte dans un pseudo-élément superposé (`data-replicated-value`), et c'est ce jumeau
 * invisible qui donne sa hauteur à la grille. Aucun défilement interne, aucun calcul de
 * mise en page déclenché à la frappe.
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
  const [draft, setDraft] = useState(segment.text);
  const [known, setKnown] = useState(segment.text);
  const [editing, setEditing] = useState(false);
  const [emptyRejected, setEmptyRejected] = useState(false);

  // Le texte de référence a changé (correction enregistrée, lot rejoué, resynchronisation
  // du flux) : le brouillon suit. Jamais pendant l'édition — rien ne bouge sous le curseur ;
  // l'arbitrage est reporté au blur, où la saisie de l'utilisateur reste prioritaire.
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
      // Correction vide refusée : le champ retrouve le dernier texte accepté, sinon
      // l'utilisateur perd de vue ce qu'il était en train de corriger.
      setDraft(segment.text);
      setKnown(segment.text);
      setEmptyRejected(true);
      return;
    }

    setEmptyRejected(false);

    if (text === known) {
      // Rien de neuf n'a été saisi. Si la référence a bougé pendant l'édition, on l'adopte
      // maintenant plutôt que de réécrire par-dessus une version plus récente que la nôtre.
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
      {/* Le tour de parole coiffe la ligne entière, timecode compris. */}
      {speakerHead}

      <button className="segment__timecode" type="button" onClick={() => onSeek(segment.startMs)}>
        {/* Le timecode visible sert d'étiquette ; le lecteur d'écran entend le geste. */}
        <VisuallyHidden>Écouter à partir de </VisuallyHidden>
        <span className="segment__clock">{clock}</span>
      </button>

      <div className="segment__body">
        {/*
         * Un label visible par ligne serait un mur de texte : le timecode voisin joue ce
         * rôle à l'œil, et le label lié — masqué — nomme le champ pour l'assistance.
         */}
        <label className="visually-hidden" htmlFor={fieldId}>
          Texte du segment à {clock}
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
         * Ligne d'état toujours présente : sa hauteur est réservée, donc l'apparition
         * d'« Enregistrement… » puis de « Corrigé » ne décale jamais la suite du transcript.
         */}
        <p className="segment__state" id={stateId}>
          {current ? <VisuallyHidden>Segment en cours de lecture.</VisuallyHidden> : null}
          {emptyRejected ? (
            <span className="segment__error" role="alert">
              Un segment ne peut pas être vide : le texte précédent a été rétabli.
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
