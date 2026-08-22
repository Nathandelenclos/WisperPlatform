import type { TranscriptionStatus } from '../../domain/transcription';
import type { WhisperModel } from '../../domain/transcription-settings';

/**
 * Modèle de lecture d'une transcription pour la liste du propriétaire.
 * `durationMs` est la fin du dernier segment connu (0 sans segment) : la durée réelle du média
 * n'est jamais mesurée, seul le contenu transcrit est connu.
 */
export type TranscriptionSummary = {
  id: string;
  status: TranscriptionStatus;
  model: WhisperModel;
  language: string;
  mediaName: string;
  mediaByteSize: number;
  segmentCount: number;
  durationMs: number;
  requestedAt: Date;
  completedAt: Date | null;
  failureReason: string | null;
};

/** Côté lecture : les transcriptions d'un propriétaire, de la plus récente à la plus ancienne. */
export interface TranscriptionCatalog {
  listOwnedBy(ownerId: string): Promise<TranscriptionSummary[]>;
}

export const TRANSCRIPTION_CATALOG = Symbol('TranscriptionCatalog');
