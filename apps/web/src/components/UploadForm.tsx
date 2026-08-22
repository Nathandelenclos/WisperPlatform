import { useState } from 'react';
import type { WhisperModel } from '../api/transcriptions';
import { formatByteSize } from '../format';

type UploadFormProps = {
  models: readonly WhisperModel[];
  languages: readonly { value: string; label: string }[];
  defaultModel: WhisperModel;
  defaultLanguage: string;
  maxByteSize: number;
  submitting: boolean;
  errorMessage: string | null;
  /** Identifiant de la dernière transcription acceptée : remet le formulaire à zéro. */
  acceptedId: string | null;
  onSubmit: (request: { file: File; model: WhisperModel; language: string }) => void;
};

/** Dépôt d'un média : sélection du fichier, du modèle et de la langue. */
export function UploadForm({
  models,
  languages,
  defaultModel,
  defaultLanguage,
  maxByteSize,
  submitting,
  errorMessage,
  acceptedId,
  onSubmit,
}: UploadFormProps) {
  const [file, setFile] = useState<File | null>(null);
  const [model, setModel] = useState<WhisperModel>(defaultModel);
  const [language, setLanguage] = useState(defaultLanguage);
  const [clearedFor, setClearedFor] = useState(acceptedId);

  if (acceptedId !== clearedFor) {
    // Le dépôt a été accepté : le champ fichier est vidé (sa `key` change) et l'état suit.
    setClearedFor(acceptedId);
    setFile(null);
  }

  const tooLarge = file !== null && file.size > maxByteSize;
  const localError = tooLarge
    ? `Fichier trop volumineux : ${formatByteSize(file.size)} pour ${formatByteSize(maxByteSize)} autorisés.`
    : errorMessage;

  return (
    <section className="panel" aria-labelledby="upload-title">
      <h2 className="panel__title" id="upload-title">
        Nouvelle transcription
      </h2>

      <form
        className="form"
        onSubmit={(submitEvent) => {
          submitEvent.preventDefault();
          if (file === null || tooLarge || submitting) return;
          onSubmit({ file, model, language });
        }}
      >
        <div className="field">
          <label className="field__label" htmlFor="upload-file">
            Fichier audio ou vidéo
          </label>
          <input
            className="field__file"
            id="upload-file"
            key={acceptedId ?? 'first'}
            name="file"
            type="file"
            accept="audio/*,video/*"
            required
            aria-describedby="upload-file-hint"
            onChange={(changeEvent) => setFile(changeEvent.target.files?.[0] ?? null)}
          />
          <p className="field__hint" id="upload-file-hint">
            {formatByteSize(maxByteSize)} maximum.
            {file === null ? '' : ` Sélectionné : ${formatByteSize(file.size)}.`}
          </p>
        </div>

        <div className="form__row">
          <div className="field">
            <label className="field__label" htmlFor="upload-model">
              Modèle
            </label>
            <select
              className="field__input"
              id="upload-model"
              name="model"
              value={model}
              onChange={(changeEvent) => {
                const chosen = models.find((candidate) => candidate === changeEvent.target.value);
                if (chosen !== undefined) setModel(chosen);
              }}
            >
              {models.map((candidate) => (
                <option key={candidate} value={candidate}>
                  {candidate}
                </option>
              ))}
            </select>
          </div>

          <div className="field">
            <label className="field__label" htmlFor="upload-language">
              Langue parlée
            </label>
            <select
              className="field__input"
              id="upload-language"
              name="language"
              value={language}
              onChange={(changeEvent) => setLanguage(changeEvent.target.value)}
            >
              {languages.map((candidate) => (
                <option key={candidate.value} value={candidate.value}>
                  {candidate.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        {localError === null ? null : (
          <p className="notice notice--error" role="alert">
            {localError}
          </p>
        )}

        <button
          className="button button--primary"
          type="submit"
          disabled={submitting || file === null || tooLarge}
        >
          {submitting ? 'Envoi du média…' : 'Lancer la transcription'}
        </button>
      </form>
    </section>
  );
}
