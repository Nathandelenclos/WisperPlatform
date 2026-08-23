import { useState } from 'react';
import { DEFAULT_PLACEMENT, type Placement, type WhisperModel } from '../api/transcriptions';
import { formatByteSize } from '../format';
import { Button, Field, FileDrop, Notice, Select } from './primitives';

/**
 * Ce que change le choix du modèle, dit sur place. Sans cette ligne, arbitrer entre
 * vitesse et fidélité obligerait à aller chercher l'information ailleurs — la décision
 * appartient à l'écran où elle se prend.
 */
const MODEL_HINTS: Record<WhisperModel, string> = {
  tiny: 'Le plus rapide, le moins fidèle : pour dégrossir un son net.',
  base: 'Rapide, correct sur une voix claire et sans bruit de fond.',
  small: 'Compromis raisonnable entre le temps de traitement et la fidélité.',
  medium: 'Fidèle, y compris sur un son moyen. Traitement sensiblement plus long.',
  large: 'Le plus fidèle, le plus lent : pour un son difficile ou plusieurs voix.',
  turbo: 'Presque la fidélité de « large », pour une fraction du temps.',
};

/**
 * Ce que le placement change pour l'utilisateur, dit en conséquence et non en mécanique :
 * ce qui l'intéresse, c'est quand sa transcription démarrera.
 */
const PLACEMENT_CHOICES: readonly { value: Placement; label: string; hint: string }[] = [
  {
    value: 'service',
    label: 'Sur les serveurs du service',
    hint: 'Démarre dès qu\u2019un worker se libère.',
  },
  {
    value: 'owner',
    label: 'Sur ma machine',
    hint: "Ne démarrera que lorsqu'une de vos machines tournera. Elle attendra sans limite de temps, et vous pourrez la confier au service à tout moment.",
  },
];

type UploadPanelProps = {
  models: readonly WhisperModel[];
  languages: readonly { value: string; label: string }[];
  defaultModel: WhisperModel;
  defaultLanguage: string;
  maxByteSize: number;
  /** Fichier retenu par le conteneur, qui en juge la taille. */
  file: File | null;
  /** Message du refus de taille, calculé par le conteneur ; bloque l'envoi. */
  sizeError: string | null;
  submitting: boolean;
  errorMessage: string | null;
  /** Identifiant de la dernière transcription acceptée : remet la zone de dépôt à zéro. */
  acceptedId: string | null;
  /**
   * Le propriétaire a au moins une machine en état de servir. Sinon il n'a rien à
   * arbitrer : le choix ne s'affiche pas, une option morte n'est que du bruit.
   */
  placementAvailable: boolean;
  onFileChange: (file: File | null) => void;
  onSubmit: (request: {
    file: File;
    model: WhisperModel;
    language: string;
    placement: Placement;
  }) => void;
};

/**
 * Dépôt d'un média : c'est l'action première de l'atelier, donc le premier panneau et la
 * seule action mise en avant. Le modèle et la langue ont un défaut utilisable tel quel.
 */
export function UploadPanel({
  models,
  languages,
  defaultModel,
  defaultLanguage,
  maxByteSize,
  file,
  sizeError,
  submitting,
  errorMessage,
  acceptedId,
  placementAvailable,
  onFileChange,
  onSubmit,
}: UploadPanelProps) {
  const [model, setModel] = useState<WhisperModel>(defaultModel);
  const [language, setLanguage] = useState(defaultLanguage);
  const [placement, setPlacement] = useState<Placement>(DEFAULT_PLACEMENT);

  const blocked = file === null || sizeError !== null;

  return (
    <section
      className="upload-panel panel"
      id="upload-panel"
      tabIndex={-1}
      aria-labelledby="upload-panel-title"
    >
      <div className="upload-panel__head">
        <h2 id="upload-panel-title">
          Nouvelle transcription
        </h2>
        <p className="upload-panel__lede">
          Déposez un audio ou une vidéo : la transcription démarre aussitôt et le texte
          s'affiche au fil de l'eau.
        </p>
      </div>

      <form
        className="upload-panel__form"
        onSubmit={(submitEvent) => {
          submitEvent.preventDefault();
          if (file === null || sizeError !== null || submitting) return;
          onSubmit({ file, model, language, placement });
        }}
      >
        <FileDrop
          // Une transcription acceptée remet la zone à neuf, input natif compris.
          key={acceptedId ?? 'first'}
          id="upload-file"
          file={file}
          accept="audio/*,video/*"
          maxLabel={`${formatByteSize(maxByteSize)} maximum`}
          error={sizeError}
          disabled={submitting}
          onFile={onFileChange}
        />

        {/*
          Le modèle et la langue ne se règlent qu'une fois un fichier choisi : avant, ils
          poussent la bibliothèque hors de l'écran, et c'est elle qu'on vient chercher en
          revenant. Leur valeur courante reste dite, pour que rien ne se décide en silence.
        */}
        {file === null ? (
          <p className="upload-panel__submit-hint">
            Réglages : modèle {model}, {languages.find((candidate) => candidate.value === language)?.label ?? language}
            {placementAvailable
              ? `, calcul ${placement === 'owner' ? 'sur votre machine' : 'sur le service'}`
              : ''}
            . Ils s'ouvrent dès qu'un fichier est choisi.
          </p>
        ) : (
          <>
            <Field id="upload-model" label="Modèle" hint={MODEL_HINTS[model]}>
              {(fieldProps) => (
                <Select
                  {...fieldProps}
                  name="model"
                  value={model}
                  disabled={submitting}
                  onChange={(changeEvent) => {
                    const chosen = models.find(
                      (candidate) => candidate === changeEvent.target.value,
                    );
                    if (chosen !== undefined) setModel(chosen);
                  }}
                >
                  {models.map((candidate) => (
                    <option key={candidate} value={candidate}>
                      {candidate}
                    </option>
                  ))}
                </Select>
              )}
            </Field>

            <Field
              id="upload-language"
              label="Langue parlée"
              hint="Le modèle transcrit dans cette langue ; il ne traduit pas."
            >
              {(fieldProps) => (
                <Select
                  {...fieldProps}
                  name="language"
                  value={language}
                  disabled={submitting}
                  onChange={(changeEvent) => setLanguage(changeEvent.target.value)}
                >
                  {languages.map((candidate) => (
                    <option key={candidate.value} value={candidate.value}>
                      {candidate.label}
                    </option>
                  ))}
                </Select>
              )}
            </Field>

            {/*
              Le placement ne s'affiche que si l'utilisateur a une machine : sans elle,
              il n'y a rien à arbitrer. Deux options exclusives et brèves : des boutons
              radio, pas une liste déroulante — les deux conséquences se lisent d'un coup.
            */}
            {placementAvailable ? (
              <fieldset className="upload-panel__placement">
                <legend className="upload-panel__placement-legend">Où calculer</legend>
                {PLACEMENT_CHOICES.map((choice) => (
                  <label className="upload-panel__choice" key={choice.value}>
                    <input
                      className="upload-panel__choice-input"
                      type="radio"
                      name="placement"
                      value={choice.value}
                      checked={placement === choice.value}
                      disabled={submitting}
                      onChange={() => setPlacement(choice.value)}
                    />
                    <span className="upload-panel__choice-text">
                      <span className="upload-panel__choice-label">{choice.label}</span>
                      <span className="upload-panel__choice-hint">{choice.hint}</span>
                    </span>
                  </label>
                ))}
              </fieldset>
            ) : null}
          </>
        )}

        {/*
          Refus venu du serveur. Le refus de taille, lui, reste sous la zone de dépôt :
          une erreur se lit à côté de ce qui l'a causée.
        */}
        <div className="upload-panel__feedback" aria-live="polite">
          {errorMessage === null ? null : (
            <Notice tone="error" title="Dépôt refusé">
              {errorMessage}
            </Notice>
          )}
        </div>

        <div className="upload-panel__submit">
          <Button type="submit" variant="primary" loading={submitting} disabled={blocked}>
            {submitting ? 'Envoi du média…' : 'Lancer la transcription'}
          </Button>
          {/* Un bouton éteint doit dire pourquoi : sans ça, l'utilisateur essaie à vide. */}
          {file === null ? (
            <p className="upload-panel__submit-hint">
              Choisissez d'abord un fichier à transcrire.
            </p>
          ) : null}
        </div>
      </form>
    </section>
  );
}
