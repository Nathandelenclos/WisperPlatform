import { useState } from 'react';
import {
  DEFAULT_PLACEMENT,
  type Placement,
  type TranscriptionLanguage,
  type WhisperModel,
} from '../api/transcriptions';
import { useTranslation, type MessageKey } from '../i18n';
import { Button, Field, FileDrop, Notice, Select } from './primitives';

/**
 * What the choice of model changes, said on the spot. Without that line, arbitrating between
 * speed and fidelity would mean going to look the information up elsewhere — the decision
 * belongs to the screen where it is taken.
 */
const MODEL_HINTS: Record<WhisperModel, MessageKey> = {
  tiny: 'upload.modelHint.tiny',
  base: 'upload.modelHint.base',
  small: 'upload.modelHint.small',
  medium: 'upload.modelHint.medium',
  large: 'upload.modelHint.large',
  turbo: 'upload.modelHint.turbo',
};

/**
 * What the placement changes for the user, said as a consequence and not as machinery: what
 * interests them is when their transcription will start.
 */
const PLACEMENT_CHOICES: readonly { value: Placement; label: MessageKey; hint: MessageKey }[] = [
  {
    value: 'service',
    label: 'upload.placementServiceLabel',
    hint: 'upload.placementServiceHint',
  },
  {
    value: 'owner',
    label: 'upload.placementOwnerLabel',
    hint: 'upload.placementOwnerHint',
  },
];

type UploadPanelProps = {
  models: readonly WhisperModel[];
  languages: readonly TranscriptionLanguage[];
  defaultModel: WhisperModel;
  defaultLanguage: TranscriptionLanguage;
  maxByteSize: number;
  /** File held by the container, which judges its size. */
  file: File | null;
  /** Message of the size refusal, computed by the container; blocks the upload. */
  sizeError: string | null;
  submitting: boolean;
  errorMessage: string | null;
  /** Id of the last accepted transcription: resets the drop zone. */
  acceptedId: string | null;
  /**
   * The owner has at least one machine in a state to serve. Otherwise they have nothing to
   * arbitrate: the choice is not shown, a dead option being nothing but noise.
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
 * Uploading a media file: it is the first action of the workspace, hence the first panel and
 * the only action put forward. The model and the language have a default usable as it stands.
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
  const { t, format } = useTranslation();
  const [model, setModel] = useState<WhisperModel>(defaultModel);
  const [language, setLanguage] = useState<TranscriptionLanguage>(defaultLanguage);
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
        <h2 id="upload-panel-title">{t('upload.title')}</h2>
        <p className="upload-panel__lede">{t('upload.lede')}</p>
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
          // An accepted transcription resets the zone, native input included.
          key={acceptedId ?? 'first'}
          id="upload-file"
          file={file}
          accept="audio/*,video/*"
          maxLabel={t('upload.maxSize', { size: format.byteSize(maxByteSize) })}
          error={sizeError}
          disabled={submitting}
          onFile={onFileChange}
        />

        {/*
          The model and the language are only adjusted once a file has been chosen: before
          that, they push the library off the screen, and the library is what one comes back
          for. Their current value is still said, so that nothing is decided in silence.
        */}
        {file === null ? (
          <p className="upload-panel__submit-hint">
            {placementAvailable
              ? t('upload.settingsWithPlacement', {
                  model,
                  language: t(`language.${language}`),
                  where:
                    placement === 'owner'
                      ? t('upload.computedOnOwner')
                      : t('upload.computedOnService'),
                })
              : t('upload.settings', { model, language: t(`language.${language}`) })}
          </p>
        ) : (
          <>
            <Field id="upload-model" label={t('upload.modelLabel')} hint={t(MODEL_HINTS[model])}>
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
              label={t('upload.languageLabel')}
              hint={t('upload.languageHint')}
            >
              {(fieldProps) => (
                <Select
                  {...fieldProps}
                  name="language"
                  value={language}
                  disabled={submitting}
                  onChange={(changeEvent) => {
                    const chosen = languages.find(
                      (candidate) => candidate === changeEvent.target.value,
                    );
                    if (chosen !== undefined) setLanguage(chosen);
                  }}
                >
                  {languages.map((candidate) => (
                    <option key={candidate} value={candidate}>
                      {t(`language.${candidate}`)}
                    </option>
                  ))}
                </Select>
              )}
            </Field>

            {/*
              The placement is only shown if the user has a machine: without one there is
              nothing to arbitrate. Two exclusive, short options: radio buttons, not a dropdown
              — both consequences are read in one go.
            */}
            {placementAvailable ? (
              <fieldset className="upload-panel__placement">
                <legend className="upload-panel__placement-legend">
                  {t('upload.placementLegend')}
                </legend>
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
                      <span className="upload-panel__choice-label">{t(choice.label)}</span>
                      <span className="upload-panel__choice-hint">{t(choice.hint)}</span>
                    </span>
                  </label>
                ))}
              </fieldset>
            ) : null}
          </>
        )}

        {/*
          Refusal coming from the server. The size refusal stays under the drop zone: an error
          is read next to what caused it.
        */}
        <div className="upload-panel__feedback" aria-live="polite">
          {errorMessage === null ? null : (
            <Notice tone="error" title={t('upload.refusedTitle')}>
              {errorMessage}
            </Notice>
          )}
        </div>

        <div className="upload-panel__submit">
          <Button type="submit" variant="primary" loading={submitting} disabled={blocked}>
            {submitting ? t('upload.submitting') : t('upload.submit')}
          </Button>
          {/* A button that is off must say why: without that, the user tries in the void. */}
          {file === null ? (
            <p className="upload-panel__submit-hint">{t('upload.chooseFirst')}</p>
          ) : null}
        </div>
      </form>
    </section>
  );
}
