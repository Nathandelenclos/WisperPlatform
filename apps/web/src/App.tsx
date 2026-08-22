import { useState } from 'react';
import {
  DEFAULT_LANGUAGE,
  DEFAULT_MODEL,
  MEDIA_MAX_BYTES,
  TRANSCRIPTION_LANGUAGES,
  WHISPER_MODELS,
  transcriptionUrls,
  type SubtitleFormat,
} from './api/transcriptions';
import { useSession } from './auth/client';
import { MIN_PASSWORD_LENGTH } from './auth/session';
import { SignInPanel } from './components/SignInPanel';
import { TranscriptionEditor } from './components/TranscriptionEditor';
import { TranscriptionList } from './components/TranscriptionList';
import { UploadForm } from './components/UploadForm';
import { useAuthCommand, useSignOut } from './hooks/use-auth';
import { useTranscriptionEvents } from './hooks/use-transcription-events';
import {
  useCorrectSegment,
  useRequestTranscription,
  useTranscription,
  useTranscriptionList,
} from './hooks/use-transcriptions';

function describeFailure(error: unknown): string | null {
  if (error === null || error === undefined) return null;
  return error instanceof Error ? error.message : 'Une erreur inattendue est survenue.';
}

/**
 * Détail de la transcription sélectionnée : requête, flux d'événements et correction.
 * L'éditeur, lui, ne reçoit que des données et des callbacks.
 */
function SelectedTranscription({ transcriptionId }: { transcriptionId: string }) {
  const detail = useTranscription(transcriptionId);
  const correction = useCorrectSegment(transcriptionId);
  const status = detail.data?.status;

  useTranscriptionEvents({
    transcriptionId,
    enabled: status === 'pending' || status === 'transcribing',
  });

  if (detail.data === undefined) {
    const failure = describeFailure(detail.error);
    return failure === null ? (
      <p className="notice" role="status">
        Chargement de la transcription…
      </p>
    ) : (
      <p className="notice notice--error" role="alert">
        {failure}
      </p>
    );
  }

  const savingOrdinal = correction.isPending ? (correction.variables?.ordinal ?? null) : null;

  return (
    <TranscriptionEditor
      transcription={detail.data}
      mediaUrl={transcriptionUrls.media(transcriptionId)}
      buildExportUrl={(format: SubtitleFormat) => transcriptionUrls.export(transcriptionId, format)}
      savingOrdinal={savingOrdinal}
      errorMessage={describeFailure(correction.error)}
      onCorrectSegment={(request) => correction.mutate(request)}
    />
  );
}

/** Espace de travail d'un utilisateur connecté : dépôt, bibliothèque, éditeur. */
function Workspace({
  displayName,
  signingOut,
  signOutError,
  onSignOut,
}: {
  displayName: string;
  signingOut: boolean;
  signOutError: string | null;
  onSignOut: () => void;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [acceptedId, setAcceptedId] = useState<string | null>(null);
  const library = useTranscriptionList();
  const upload = useRequestTranscription();

  return (
    <div className="app">
      <header className="topbar">
        <p className="wordmark">WisperPlatform</p>
        <div className="topbar__user">
          <span className="topbar__name">{displayName}</span>
          {signOutError === null ? null : (
            <span className="topbar__error" role="alert">
              {signOutError}
            </span>
          )}
          <button
            className="button button--ghost"
            type="button"
            disabled={signingOut}
            onClick={onSignOut}
          >
            {signingOut ? 'Déconnexion…' : 'Se déconnecter'}
          </button>
        </div>
      </header>

      <main className="workspace">
        <div className="workspace__side">
          <UploadForm
            models={WHISPER_MODELS}
            languages={TRANSCRIPTION_LANGUAGES}
            defaultModel={DEFAULT_MODEL}
            defaultLanguage={DEFAULT_LANGUAGE}
            maxByteSize={MEDIA_MAX_BYTES}
            submitting={upload.isPending}
            errorMessage={describeFailure(upload.error)}
            acceptedId={acceptedId}
            onSubmit={(request) =>
              upload.mutate(request, {
                onSuccess: (accepted) => {
                  // On ouvre aussitôt la transcription : les segments y arrivent en direct.
                  setAcceptedId(accepted.id);
                  setSelectedId(accepted.id);
                },
              })
            }
          />

          <TranscriptionList
            items={library.data ?? []}
            selectedId={selectedId}
            loading={library.isPending}
            errorMessage={describeFailure(library.error)}
            onSelect={setSelectedId}
          />
        </div>

        <div className="workspace__main">
          {selectedId === null ? (
            <p className="empty empty--main">
              Choisissez une transcription dans la liste pour lire le média, corriger le texte et
              l'exporter.
            </p>
          ) : (
            <SelectedTranscription transcriptionId={selectedId} />
          )}
        </div>
      </main>
    </div>
  );
}

export function App() {
  const session = useSession();
  const authCommand = useAuthCommand();
  const signOutCommand = useSignOut();

  if (session.isPending) {
    return (
      <main className="boot" role="status">
        Ouverture de votre session…
      </main>
    );
  }

  const account = session.data;
  if (account === null || account === undefined) {
    return (
      <SignInPanel
        onSubmit={(command) => authCommand.mutate(command)}
        submitting={authCommand.isPending}
        errorMessage={describeFailure(authCommand.error)}
        minPasswordLength={MIN_PASSWORD_LENGTH}
      />
    );
  }

  return (
    <Workspace
      displayName={account.user.name === '' ? account.user.email : account.user.name}
      signingOut={signOutCommand.isPending}
      signOutError={describeFailure(signOutCommand.error)}
      onSignOut={() => signOutCommand.mutate()}
    />
  );
}
