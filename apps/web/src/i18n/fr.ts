import type { Messages } from './en';

/**
 * Catalogue français. Le type vient de l'anglais : une clé oubliée ou une clé en trop est une
 * erreur de compilation, jamais une chaîne vide à l'écran.
 */
export const fr: Messages = {
  // --- Coquille ----------------------------------------------------------------------------
  'app.skipToContent': 'Aller au contenu principal',
  'app.workspaceLabel': 'Atelier de transcription',
  'app.detailLabel': 'Transcription ouverte',
  'app.openingSession': 'Ouverture de votre session…',

  'action.retry': 'Réessayer',

  'detail.crashTitle': 'Affichage interrompu',
  'detail.crashBody':
    "Cette transcription n'a pas pu s'afficher. Réessayez, ou ouvrez-en une autre depuis la bibliothèque.",
  'detail.unreadableTitle': 'Transcription illisible',
  'detail.opening': 'Ouverture de la transcription…',

  // --- Langue ------------------------------------------------------------------------------
  'language.selectorLabel': 'Langue',

  'language.French': 'Français',
  'language.English': 'Anglais',
  'language.Spanish': 'Espagnol',
  'language.German': 'Allemand',
  'language.Italian': 'Italien',
  'language.Portuguese': 'Portugais',
  'language.Dutch': 'Néerlandais',
  'language.Russian': 'Russe',
  'language.Arabic': 'Arabe',
  'language.Japanese': 'Japonais',
  'language.Chinese': 'Chinois',
  'language.Korean': 'Coréen',

  // --- Échecs signalés par le client --------------------------------------------------------
  'error.unexpected': 'Une erreur inattendue est survenue.',
  'error.networkUnreachable': 'Serveur injoignable. Vérifiez votre connexion.',
  'error.requestTimeout': "Le serveur n'a pas répondu dans le délai imparti.",
  'error.authUnreachable':
    "Le serveur d'authentification est injoignable. Réessayez dans un instant.",
  'error.invalidCredentials': 'Adresse e-mail ou mot de passe incorrect.',
  'error.signUpRefused':
    'Inscription refusée : adresse déjà utilisée, ou mot de passe trop court ({min} caractères minimum).',
  'error.authFailed': "Échec de l'authentification.",

  // --- Connexion ---------------------------------------------------------------------------
  'signIn.signInTitle': 'Se connecter',
  'signIn.signUpTitle': 'Créer un compte',
  'signIn.tagline': 'Vos médias transcrits sur votre serveur.',
  'signIn.nameLabel': 'Nom affiché',
  'signIn.emailLabel': 'Adresse e-mail',
  'signIn.passwordLabel': 'Mot de passe',
  'signIn.passwordHint': '{min} caractères minimum.',
  'signIn.allRequired': 'Tous les champs sont requis.',
  'signIn.signInRefused': 'Connexion refusée',
  'signIn.signUpRefused': 'Inscription refusée',
  'signIn.signingIn': 'Connexion…',
  'signIn.signingUp': 'Création du compte…',
  'signIn.submitSignUp': 'Créer le compte',
  'signIn.or': 'ou',
  'signIn.google': 'Continuer avec Google',
  'signIn.googleOpening': 'Ouverture de Google…',
  'signIn.haveAccount': 'Vous avez déjà un compte ?',
  'signIn.firstVisit': 'Première visite ?',

  // --- Barre de titre ------------------------------------------------------------------------
  'topBar.signOut': 'Se déconnecter',
  'topBar.signingOut': 'Déconnexion…',

  // --- Dépôt -------------------------------------------------------------------------------
  'upload.title': 'Nouvelle transcription',
  'upload.lede':
    "Déposez un audio ou une vidéo : la transcription démarre aussitôt et le texte s'affiche au fil de l'eau.",
  'upload.tooLarge': 'Fichier trop volumineux : {size} pour {max} autorisés.',
  'upload.maxSize': '{size} maximum',
  'upload.modelLabel': 'Modèle',
  'upload.languageLabel': 'Langue parlée',
  'upload.languageHint': 'Le modèle transcrit dans cette langue ; il ne traduit pas.',
  'upload.placementLegend': 'Où calculer',
  'upload.placementServiceLabel': 'Sur les serveurs du service',
  'upload.placementServiceHint': "Démarre dès qu'un worker se libère.",
  'upload.placementOwnerLabel': 'Sur ma machine',
  'upload.placementOwnerHint':
    "Ne démarrera que lorsqu'une de vos machines tournera. Elle attendra sans limite de temps, et vous pourrez la confier au service à tout moment.",
  'upload.settings':
    "Réglages : modèle {model}, {language}. Ils s'ouvrent dès qu'un fichier est choisi.",
  'upload.settingsWithPlacement':
    "Réglages : modèle {model}, {language}, calcul {where}. Ils s'ouvrent dès qu'un fichier est choisi.",
  'upload.computedOnOwner': 'sur votre machine',
  'upload.computedOnService': 'sur le service',
  'upload.refusedTitle': 'Dépôt refusé',
  'upload.submit': 'Lancer la transcription',
  'upload.submitting': 'Envoi du média…',
  'upload.chooseFirst': "Choisissez d'abord un fichier à transcrire.",

  'upload.modelHint.tiny': 'Le plus rapide, le moins fidèle : pour dégrossir un son net.',
  'upload.modelHint.base': 'Rapide, correct sur une voix claire et sans bruit de fond.',
  'upload.modelHint.small': 'Compromis raisonnable entre le temps de traitement et la fidélité.',
  'upload.modelHint.medium':
    'Fidèle, y compris sur un son moyen. Traitement sensiblement plus long.',
  'upload.modelHint.large':
    'Le plus fidèle, le plus lent : pour un son difficile ou plusieurs voix.',
  'upload.modelHint.turbo': 'Presque la fidélité de « large », pour une fraction du temps.',

  // --- Zone de dépôt -------------------------------------------------------------------------
  'fileDrop.lead': 'Déposez un fichier audio ou vidéo',
  'fileDrop.cue': 'ou parcourez vos fichiers',
  'fileDrop.none': 'Aucun fichier choisi',
  'fileDrop.chosen': 'Fichier choisi : {name} ({size})',
  'fileDrop.remove': 'Retirer',

  // --- Bibliothèque --------------------------------------------------------------------------
  'library.title': 'Mes transcriptions',
  'library.unavailableTitle': 'Bibliothèque indisponible',
  'library.loading': 'Chargement de vos transcriptions…',
  'library.emptyTitle': "Aucune transcription pour l'instant",
  'library.emptyDescription':
    'Déposez un audio ou une vidéo : les phrases apparaîtront ici au fil de la transcription, et chaque transcription restera consultable ensuite.',
  'library.emptyAction': 'Choisir un fichier',
  'library.model': 'Modèle',
  'library.language': 'Langue',
  'library.duration': 'Durée',
  'library.computation': 'Calcul',
  'library.awaitingYourMachine': 'en attente de votre machine',
  'library.yourMachine': 'votre machine',
  'library.starting': 'transcription en cours de démarrage',
  'library.segments': { one: '{count} segment', other: '{count} segments' },
  'library.segmentsReceived': {
    one: '{count} segment déjà reçu',
    other: '{count} segments déjà reçus',
  },

  // --- Machines ----------------------------------------------------------------------------
  'machines.title': 'Mes machines',
  'machines.lede':
    'Une machine à vous peut transcrire vos médias à la place des serveurs du service. Déclarez-la ici, puis lancez le worker avec la clé obtenue.',
  'machines.unavailableTitle': 'Machines indisponibles',
  'machines.notDeclaredTitle': 'Machine non déclarée',
  'machines.revokeRefusedTitle': 'Révocation refusée',
  'machines.formLabel': 'Déclarer une machine',
  'machines.labelField': 'Nom de la machine',
  'machines.labelHint':
    "Pour vous y retrouver : « portable », « tour du bureau ». La clé secrète s'affichera une seule fois, juste après la création.",
  'machines.declare': 'Déclarer une machine',
  'machines.creating': 'Création de la clé…',
  'machines.secretTitle': 'Clé de « {label} »',
  'machines.secretWarning':
    "Cette clé ne sera plus jamais affichée : la plateforme n'en garde qu'une empreinte. Copiez-la maintenant.",
  'machines.copyKey': 'Copier la clé',
  'machines.keyCopied': 'Clé copiée.',
  'machines.commandStep': 'Commande de lancement, clé comprise :',
  'machines.copyCommand': 'Copier la commande',
  'machines.commandCopied': 'Commande copiée.',
  'machines.copyFailed':
    'Copie refusée par le navigateur. Sélectionnez le texte et copiez-le à la main.',
  'machines.secretAcknowledged': "J'ai copié la clé",
  'machines.emptyTitle': 'Aucune machine déclarée',
  'machines.emptyDescription':
    'Vos transcriptions partent sur les serveurs du service. Déclarez une machine pour pouvoir les calculer chez vous.',
  'machines.revokedBadge': 'Révoquée',
  'machines.revokedOn': 'Révoquée',
  'machines.revokedNote': 'Le worker qui la porte est refusé.',
  'machines.neverSeen': "Jamais vue : aucun worker ne s'est encore présenté avec cette clé.",
  'machines.seenOn': 'Vue',
  'machines.revokeOpen': 'Révoquer…',
  'machines.revokeCancel': 'Annuler',
  'machines.revokeWarning':
    "Le worker qui porte cette clé sera refusé dès son prochain appel. C'est définitif : il faudra déclarer une nouvelle machine.",
  'machines.revokeConfirm': 'Révoquer « {label} »',

  // --- Transcription -------------------------------------------------------------------------
  'transcript.factModel': 'Modèle',
  'transcript.factLanguage': 'Langue',
  'transcript.factMedia': 'Média',
  'transcript.factUploaded': 'Déposé',
  'transcript.factComputation': 'Calcul',
  'transcript.factYourMachine': 'Votre machine',
  'transcript.factSpeech': 'Parole',
  'transcript.soundOnly':
    "Ce fichier ne contient pas d'image exploitable : seule sa bande son est lue.",
  'transcript.failedTitle': 'La transcription a échoué',
  'transcript.failedNoReason':
    "Le worker n'a transmis aucune raison. Un nouveau dépôt du média relance une tentative.",
  'transcript.uploadAgain': 'Déposer à nouveau',
  'transcript.waitingOwnMachineTitle': 'En attente de votre machine',
  'transcript.waitingOwnMachineBody':
    "Cette transcription est réservée à vos machines : elle démarrera dès que l'une d'elles tournera, et attendra aussi longtemps qu'il le faudra.",
  'transcript.handToService': 'Confier au service',
  'transcript.notMovedTitle': 'Transcription non déplacée',
  'transcript.streamLostTitle': 'Direct interrompu',
  'transcript.streamLostBody':
    "Les segments n'arrivent plus au fil de l'eau. La vue est rafraîchie toutes les quelques secondes en attendant.",
  'transcript.reconnect': 'Reconnecter',
  'transcript.readOnly':
    "Texte en lecture seule : la correction s'ouvre une fois la transcription terminée.",
  'transcript.follow': 'Suivre la lecture',
  'transcript.followHint':
    "Le transcript défile jusqu'au segment lu. Le suivi se suspend tant que le curseur est posé dans un texte : rien ne bouge sous le curseur.",
  'transcript.noSpeechTitle': 'Aucune parole détectée',
  'transcript.noSpeechDescription':
    "Le média a bien été analysé, mais aucune parole exploitable n'y a été trouvée. Un autre fichier, ou un modèle plus grand, donnera peut-être un meilleur résultat.",
  'transcript.uploadAnother': 'Déposer un autre média',

  'transcript.progressPendingOwner':
    "En attente de votre machine : la transcription démarrera dès qu'une des vôtres tournera.",
  'transcript.progressPendingService':
    "En file d'attente : la transcription démarrera dès qu'un worker sera libre.",
  'transcript.progressTranscribing': {
    one: "{count} segment transcrit — la suite arrive au fil de l'eau.",
    other: "{count} segments transcrits — la suite arrive au fil de l'eau.",
  },
  'transcript.progressCompleted': {
    one: '{count} segment. Corrigez une ligne en cliquant dans son texte.',
    other: '{count} segments. Corrigez une ligne en cliquant dans son texte.',
  },
  'transcript.progressFailedEmpty': "L'échec est survenu avant le premier segment.",
  'transcript.progressFailed': {
    one: "{count} segment transcrit avant l'échec.",
    other: "{count} segments transcrits avant l'échec.",
  },

  'transcript.announceSaved': 'Segment enregistré.',
  'transcript.announceSavedAt': 'Segment à {at} enregistré.',
  'transcript.announceNotSaved': 'Segment non enregistré : {reason}',
  'transcript.announceNotSavedAt': 'Segment à {at} non enregistré : {reason}',
  'transcript.announceRenamed': 'Locuteur renommé dans toute la transcription.',
  'transcript.announceRenamedTo': 'Locuteur renommé en {name} dans toute la transcription.',
  'transcript.announceRenameFailed': 'Locuteur non renommé : {reason}',
  'transcript.announceStreamLost':
    "Connexion au direct perdue : les segments n'arrivent plus au fil de l'eau.",
  'transcript.announceStreamBack': 'Connexion au direct rétablie.',

  // --- Segment -----------------------------------------------------------------------------
  'segment.playFrom': 'Écouter à partir de',
  'segment.textLabel': 'Texte du segment à {at}',
  'segment.playing': 'Segment en cours de lecture.',
  'segment.emptyRejected':
    'Un segment ne peut pas être vide : le texte précédent a été rétabli.',
  'segment.saving': 'Enregistrement…',
  'segment.corrected': 'Corrigé',

  // --- Locuteur ----------------------------------------------------------------------------
  'speaker.fallbackName': 'Locuteur {index}',
  'speaker.renameHint': ', renommer ce locuteur dans toute la transcription',
  'speaker.nameLabel': 'Nom du locuteur',
  'speaker.nameFieldHint':
    'Renommer ce locuteur dans toute la transcription, partout où {name} parle.',
  'speaker.emptyRejected': 'Un nom de locuteur ne peut pas être vide.',
  'speaker.rename': 'Renommer',
  'speaker.cancel': 'Annuler',

  // --- Export ------------------------------------------------------------------------------
  'export.title': 'Exporter',
  'export.txtLabel': 'Texte brut',
  'export.srtUse': 'Sous-titres, pour un lecteur ou un logiciel de montage',
  'export.vttUse': 'Sous-titres, pour un lecteur vidéo sur le web',
  'export.txtUse': 'Le texte seul, sans timecode, à copier-coller',

  // --- Rien de sélectionné ---------------------------------------------------------------------
  'noSelection.title': 'Aucune transcription ouverte',
  'noSelection.description':
    "Choisissez une transcription dans la bibliothèque pour lire le média, corriger le texte et l'exporter.",
  'noSelection.action': 'Déposer un média',

  // --- Primitives ----------------------------------------------------------------------------
  'button.busy': ', en cours',

  'notice.info': 'Information :',
  'notice.warning': 'Attention :',
  'notice.error': 'Erreur :',
  'notice.success': 'Succès :',

  'status.pending': 'En attente',
  'status.transcribing': 'En cours',
  'status.completed': 'Terminée',
  'status.failed': 'Échec',
};
