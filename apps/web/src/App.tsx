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
import { NoSelection } from './components/NoSelection';
import { SignInPanel } from './components/SignInPanel';
import { TopBar } from './components/TopBar';
import { TranscriptionEditor } from './components/TranscriptionEditor';
import { TranscriptionList } from './components/TranscriptionList';
import { UploadForm } from './components/UploadForm';
import { formatByteSize } from './format';
import { useAuthCommand, useSignOut } from './hooks/use-auth';
import { useTranscriptionEvents, type StreamState } from './hooks/use-transcription-events';
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
  const [stream, setStream] = useState<StreamState>('connecting');
  // Jeton de reprise : l'incrémenter rouvre le flux, c'est le bouton « Reconnecter ».
  const [resumeToken, setResumeToken] = useState(0);

  // Flux perdu : le détail est rappelé périodiquement, faute de mieux, pour que la vue
  // finisse quand même par voir la fin de la transcription.
  const detail = useTranscription(transcriptionId, { degraded: stream === 'lost' });
  const correction = useCorrectSegment(transcriptionId);
  const status = detail.data?.status;

  useTranscriptionEvents({
    transcriptionId,
    enabled: status === 'pending' || status === 'transcribing',
    resumeToken,
    onStateChange: setStream,
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
      streamLost={stream === 'lost'}
      onRetryStream={() => setResumeToken((token) => token + 1)}
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
  const [file, setFile] = useState<File | null>(null);
  const library = useTranscriptionList();
  const upload = useRequestTranscription();

  // Règle de taille du média : elle appartient au contrat de l'API, pas au formulaire.
  const sizeError =
    file !== null && file.size > MEDIA_MAX_BYTES
      ? `Fichier trop volumineux : ${formatByteSize(file.size)} pour ${formatByteSize(MEDIA_MAX_BYTES)} autorisés.`
      : null;

  return (
    <div className="app">
      <TopBar
        displayName={displayName}
        signingOut={signingOut}
        signOutError={signOutError}
        onSignOut={onSignOut}
      />

      <main className="workspace">
        <div className="workspace__side">
          <UploadForm
            models={WHISPER_MODELS}
            languages={TRANSCRIPTION_LANGUAGES}
            defaultModel={DEFAULT_MODEL}
            defaultLanguage={DEFAULT_LANGUAGE}
            maxByteSize={MEDIA_MAX_BYTES}
            file={file}
            sizeError={sizeError}
            submitting={upload.isPending}
            errorMessage={describeFailure(upload.error)}
            acceptedId={acceptedId}
            onFileChange={setFile}
            onSubmit={(request) =>
              upload.mutate(request, {
                onSuccess: (accepted) => {
                  // On ouvre aussitôt la transcription : les segments y arrivent en direct.
                  setAcceptedId(accepted.id);
                  setSelectedId(accepted.id);
                  setFile(null);
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
            <NoSelection />
          ) : (
            <SelectedTranscription key={selectedId} transcriptionId={selectedId} />
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
