import type { WhisperModel } from '../../domain/transcription-settings';

export interface TranscriptionQueue {
  /**
   * Réservation atomique d'une transcription en attente dont le modèle est servi par le worker.
   * Purement technique : elle empêche deux workers de charger le même aggregate et expire seule
   * au bout de `reservationSeconds`. Renvoie l'identifiant réservé, ou `null` s'il n'y a rien.
   */
  reserveNextPending(p: {
    workerId: string;
    models: readonly WhisperModel[];
    reservationSeconds: number;
    now: Date;
  }): Promise<string | null>;

  /** Identifiants des transcriptions en cours dont le bail est dépassé. */
  findStalled(p: { now: Date; limit: number }): Promise<string[]>;
}

export const TRANSCRIPTION_QUEUE = Symbol('TranscriptionQueue');
