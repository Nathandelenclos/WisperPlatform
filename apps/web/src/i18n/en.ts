/**
 * English catalogue — the reference. Every key exists here first; `fr.ts` is typed against it,
 * so a key missing or added on one side is a compile error, never an empty string on screen.
 *
 * Values carry named placeholders (`{name}`), never markup: rich text is composed in JSX
 * around translated fragments, which keeps the catalogue plain data and `innerHTML` out.
 */

/**
 * A message with two written forms. Which one applies is decided by `Intl.PluralRules`, not by
 * `count === 1`: English writes "0 segments" where French writes "0 segment".
 *
 * ponytail: two forms only, which covers English and French. A language with `few`/`many`
 * (Russian, Polish, Arabic) needs those forms added here and in the selector of `index.tsx`.
 */
export type Plural = { one: string; other: string };

export const en = {
  // --- Shell -------------------------------------------------------------------------------
  'app.skipToContent': 'Skip to main content',
  'app.workspaceLabel': 'Transcription workspace',
  'app.detailLabel': 'Open transcription',
  'app.openingSession': 'Opening your session…',

  'action.retry': 'Try again',

  'detail.crashTitle': 'Display interrupted',
  'detail.crashBody':
    'This transcription could not be displayed. Try again, or open another one from the library.',
  'detail.unreadableTitle': 'Transcription unreadable',
  'detail.opening': 'Opening the transcription…',

  // --- Language ----------------------------------------------------------------------------
  'language.selectorLabel': 'Language',

  // Spoken languages offered for transcription, keyed by the value sent to the worker.
  'language.French': 'French',
  'language.English': 'English',
  'language.Spanish': 'Spanish',
  'language.German': 'German',
  'language.Italian': 'Italian',
  'language.Portuguese': 'Portuguese',
  'language.Dutch': 'Dutch',
  'language.Russian': 'Russian',
  'language.Arabic': 'Arabic',
  'language.Japanese': 'Japanese',
  'language.Chinese': 'Chinese',
  'language.Korean': 'Korean',

  // --- Failures reported by the client ------------------------------------------------------
  'error.unexpected': 'Something unexpected happened.',
  'error.networkUnreachable': 'Server unreachable. Check your connection.',
  'error.requestTimeout': 'The server did not answer within the allotted time.',
  'error.authUnreachable': 'The authentication server is unreachable. Try again in a moment.',
  'error.invalidCredentials': 'Incorrect email address or password.',
  'error.signUpRefused':
    'Sign-up refused: address already in use, or password too short ({min} characters minimum).',
  'error.authFailed': 'Authentication failed.',

  // --- Sign in -----------------------------------------------------------------------------
  'signIn.signInTitle': 'Sign in',
  'signIn.signUpTitle': 'Create an account',
  'signIn.tagline': 'Your media transcribed on your own server.',
  'signIn.nameLabel': 'Display name',
  'signIn.emailLabel': 'Email address',
  'signIn.passwordLabel': 'Password',
  'signIn.passwordHint': '{min} characters minimum.',
  'signIn.allRequired': 'All fields are required.',
  'signIn.signInRefused': 'Sign-in refused',
  'signIn.signUpRefused': 'Sign-up refused',
  'signIn.signingIn': 'Signing in…',
  'signIn.signingUp': 'Creating the account…',
  'signIn.submitSignUp': 'Create the account',
  'signIn.or': 'or',
  'signIn.google': 'Continue with Google',
  'signIn.googleOpening': 'Opening Google…',
  'signIn.haveAccount': 'Already have an account?',
  'signIn.firstVisit': 'First time here?',

  // --- Top bar -----------------------------------------------------------------------------
  'topBar.signOut': 'Sign out',
  'topBar.signingOut': 'Signing out…',

  // --- Upload ------------------------------------------------------------------------------
  'upload.title': 'New transcription',
  'upload.lede':
    'Drop an audio or video file: the transcription starts right away and the text appears as it comes.',
  'upload.tooLarge': 'File too large: {size} for {max} allowed.',
  'upload.maxSize': '{size} maximum',
  'upload.modelLabel': 'Model',
  'upload.languageLabel': 'Spoken language',
  'upload.languageHint': 'The model transcribes in that language; it does not translate.',
  'upload.placementLegend': 'Where to compute',
  'upload.placementServiceLabel': 'On the service servers',
  'upload.placementServiceHint': 'Starts as soon as a worker frees up.',
  'upload.placementOwnerLabel': 'On my machine',
  'upload.placementOwnerHint':
    'Will only start once one of your machines is running. It will wait with no time limit, and you can hand it over to the service at any moment.',
  'upload.settings': 'Settings: {model} model, {language}. They open as soon as a file is chosen.',
  'upload.settingsWithPlacement':
    'Settings: {model} model, {language}, computed {where}. They open as soon as a file is chosen.',
  'upload.computedOnOwner': 'on your machine',
  'upload.computedOnService': 'on the service',
  'upload.refusedTitle': 'Upload refused',
  'upload.submit': 'Start the transcription',
  'upload.submitting': 'Sending the media…',
  'upload.chooseFirst': 'Choose a file to transcribe first.',

  // Model choice, said where the choice is made.
  'upload.modelHint.tiny': 'The fastest, the least faithful: to rough out a clean recording.',
  'upload.modelHint.base': 'Fast, decent on a clear voice with no background noise.',
  'upload.modelHint.small': 'A reasonable trade-off between processing time and fidelity.',
  'upload.modelHint.medium':
    'Faithful, even on average sound. Noticeably longer to process.',
  'upload.modelHint.large':
    'The most faithful, the slowest: for difficult sound or several voices.',
  'upload.modelHint.turbo': 'Almost the fidelity of “large”, for a fraction of the time.',

  // --- File drop ---------------------------------------------------------------------------
  'fileDrop.lead': 'Drop an audio or video file',
  'fileDrop.cue': 'or browse your files',
  'fileDrop.none': 'No file chosen',
  'fileDrop.chosen': 'Chosen file: {name} ({size})',
  'fileDrop.remove': 'Remove',

  // --- Library -----------------------------------------------------------------------------
  'library.title': 'My transcriptions',
  'library.unavailableTitle': 'Library unavailable',
  'library.loading': 'Loading your transcriptions…',
  'library.emptyTitle': 'No transcription yet',
  'library.emptyDescription':
    'Drop an audio or video file: the sentences will appear here as the transcription goes, and every transcription stays available afterwards.',
  'library.emptyAction': 'Choose a file',
  'library.model': 'Model',
  'library.language': 'Language',
  'library.duration': 'Duration',
  'library.computation': 'Computation',
  'library.awaitingYourMachine': 'waiting for your machine',
  'library.yourMachine': 'your machine',
  'library.starting': 'transcription starting up',
  'library.segments': { one: '{count} segment', other: '{count} segments' },
  'library.segmentsReceived': {
    one: '{count} segment received so far',
    other: '{count} segments received so far',
  },

  // --- Machines ----------------------------------------------------------------------------
  'machines.title': 'My machines',
  'machines.lede':
    'A machine of your own can transcribe your media instead of the service servers. Declare it here, then start the worker with the key you get.',
  'machines.unavailableTitle': 'Machines unavailable',
  'machines.notDeclaredTitle': 'Machine not declared',
  'machines.revokeRefusedTitle': 'Revocation refused',
  'machines.formLabel': 'Declare a machine',
  'machines.labelField': 'Machine name',
  'machines.labelHint':
    'So you can tell them apart: “laptop”, “office tower”. The secret key is shown exactly once, right after creation.',
  'machines.declare': 'Declare a machine',
  'machines.creating': 'Creating the key…',
  'machines.secretTitle': 'Key for “{label}”',
  'machines.secretWarning':
    'This key will never be shown again: the platform only keeps a fingerprint of it. Copy it now.',
  'machines.copyKey': 'Copy the key',
  'machines.keyCopied': 'Key copied.',
  'machines.commandStep': 'Start command, key included:',
  'machines.copyCommand': 'Copy the command',
  'machines.commandCopied': 'Command copied.',
  'machines.copyFailed': 'Copy refused by the browser. Select the text and copy it by hand.',
  'machines.secretAcknowledged': 'I have copied the key',
  'machines.emptyTitle': 'No machine declared',
  'machines.emptyDescription':
    'Your transcriptions go to the service servers. Declare a machine to compute them at your place.',
  'machines.revokedBadge': 'Revoked',
  'machines.revokedOn': 'Revoked',
  'machines.revokedNote': 'The worker carrying it is refused.',
  'machines.neverSeen': 'Never seen: no worker has shown up with this key yet.',
  'machines.seenOn': 'Seen',
  'machines.revokeOpen': 'Revoke…',
  'machines.revokeCancel': 'Cancel',
  'machines.revokeWarning':
    'The worker carrying this key will be refused on its next call. This is permanent: you will have to declare a new machine.',
  'machines.revokeConfirm': 'Revoke “{label}”',

  // --- Transcript --------------------------------------------------------------------------
  'transcript.factModel': 'Model',
  'transcript.factLanguage': 'Language',
  'transcript.factMedia': 'Media',
  'transcript.factUploaded': 'Uploaded',
  'transcript.factComputation': 'Computation',
  'transcript.factYourMachine': 'Your machine',
  'transcript.factSpeech': 'Speech',
  'transcript.soundOnly': 'This file holds no usable picture: only its sound track is played.',
  'transcript.failedTitle': 'The transcription failed',
  'transcript.failedNoReason':
    'The worker gave no reason. Uploading the media again starts a new attempt.',
  'transcript.uploadAgain': 'Upload again',
  'transcript.waitingOwnMachineTitle': 'Waiting for your machine',
  'transcript.waitingOwnMachineBody':
    'This transcription is reserved for your machines: it will start as soon as one of them is running, and will wait as long as it takes.',
  'transcript.handToService': 'Hand over to the service',
  'transcript.notMovedTitle': 'Transcription not moved',
  'transcript.streamLostTitle': 'Live feed interrupted',
  'transcript.streamLostBody':
    'Segments no longer arrive as they come. The view is refreshed every few seconds in the meantime.',
  'transcript.reconnect': 'Reconnect',
  'transcript.readOnly':
    'Read-only text: correcting opens once the transcription is finished.',
  'transcript.follow': 'Follow playback',
  'transcript.followHint':
    'The transcript scrolls to the segment being played. Following is suspended while the cursor sits in a text: nothing moves under the cursor.',
  'transcript.noSpeechTitle': 'No speech detected',
  'transcript.noSpeechDescription':
    'The media was analysed, but no usable speech was found in it. Another file, or a larger model, may give a better result.',
  'transcript.uploadAnother': 'Upload another media file',

  'transcript.progressPendingOwner':
    'Waiting for your machine: the transcription will start as soon as one of yours is running.',
  'transcript.progressPendingService':
    'Queued: the transcription will start as soon as a worker frees up.',
  'transcript.progressTranscribing': {
    one: '{count} segment transcribed — the rest arrives as it comes.',
    other: '{count} segments transcribed — the rest arrives as it comes.',
  },
  'transcript.progressCompleted': {
    one: '{count} segment. Correct a line by clicking in its text.',
    other: '{count} segments. Correct a line by clicking in its text.',
  },
  'transcript.progressFailedEmpty': 'The failure happened before the first segment.',
  'transcript.progressFailed': {
    one: '{count} segment transcribed before the failure.',
    other: '{count} segments transcribed before the failure.',
  },

  'transcript.announceSaved': 'Segment saved.',
  'transcript.announceSavedAt': 'Segment at {at} saved.',
  'transcript.announceNotSaved': 'Segment not saved: {reason}',
  'transcript.announceNotSavedAt': 'Segment at {at} not saved: {reason}',
  'transcript.announceRenamed': 'Speaker renamed throughout the transcription.',
  'transcript.announceRenamedTo': 'Speaker renamed to {name} throughout the transcription.',
  'transcript.announceRenameFailed': 'Speaker not renamed: {reason}',
  'transcript.announceStreamLost':
    'Live connection lost: segments no longer arrive as they come.',
  'transcript.announceStreamBack': 'Live connection restored.',

  // --- Segment -----------------------------------------------------------------------------
  'segment.playFrom': 'Play from',
  'segment.textLabel': 'Segment text at {at}',
  'segment.playing': 'Segment currently playing.',
  'segment.emptyRejected': 'A segment cannot be empty: the previous text has been restored.',
  'segment.saving': 'Saving…',
  'segment.corrected': 'Corrected',

  // --- Speaker -----------------------------------------------------------------------------
  'speaker.fallbackName': 'Speaker {index}',
  'speaker.renameHint': ', rename this speaker throughout the transcription',
  'speaker.nameLabel': 'Speaker name',
  'speaker.nameFieldHint':
    'Rename this speaker throughout the transcription, everywhere {name} speaks.',
  'speaker.emptyRejected': 'A speaker name cannot be empty.',
  'speaker.rename': 'Rename',
  'speaker.cancel': 'Cancel',

  // --- Export ------------------------------------------------------------------------------
  'export.title': 'Export',
  'export.txtLabel': 'Plain text',
  'export.srtUse': 'Subtitles, for a player or a video editor',
  'export.vttUse': 'Subtitles, for a video player on the web',
  'export.txtUse': 'The text alone, without timecodes, to copy and paste',

  // --- Nothing selected ---------------------------------------------------------------------
  'noSelection.title': 'No transcription open',
  'noSelection.description':
    'Choose a transcription in the library to play the media, correct the text and export it.',
  'noSelection.action': 'Upload a media file',

  // --- Primitives ----------------------------------------------------------------------------
  'button.busy': ', busy',

  // Punctuation included: French puts a space before a colon, English does not.
  'notice.info': 'Information:',
  'notice.warning': 'Warning:',
  'notice.error': 'Error:',
  'notice.success': 'Success:',

  'status.pending': 'Pending',
  'status.transcribing': 'In progress',
  'status.completed': 'Completed',
  'status.failed': 'Failed',
};

/** Shape every catalogue must have, values widened to `string` / `Plural` by inference. */
export type Messages = typeof en;
export type MessageKey = keyof Messages;
