import type { WhisperModel } from '../../domain/transcription-settings';
import type { Claimant } from './worker-identities';

export interface TranscriptionQueue {
  /**
   * Réservation atomique d'une transcription en attente dont le modèle est servi par le worker.
   * Purement technique : elle empêche deux workers de charger le même aggregate et expire seule
   * au bout de `reservationSeconds`. Renvoie l'identifiant réservé, ou `null` s'il n'y a rien.
   *
   * Le réclamant borne ce qui peut être proposé, et ce cloisonnement est absolu :
   * - `service` ne voit QUE les transcriptions de placement `service` ;
   * - `owner` ne voit QUE les transcriptions de placement `owner` dont il est propriétaire.
   *
   * Aucun croisement, dans aucun sens : une demande placée sur la machine de son propriétaire
   * n'est jamais servie au service, même si elle attend depuis longtemps, et une demande du
   * service n'est jamais servie à une machine d'utilisateur.
   */
  reserveNextPending(p: {
    claimant: Claimant;
    workerId: string;
    models: readonly WhisperModel[];
    reservationSeconds: number;
    now: Date;
  }): Promise<string | null>;

  /** Identifiants des transcriptions en cours dont le bail est dépassé. */
  /**
   * Lève la réservation technique posée par `reserveNextPending`. Rendre une tentative sans
   * ça laisse la demande invisible pendant la fenêtre de réservation : elle est bien `pending`,
   * mais aucun worker ne se la voit proposer, ce qui annule tout l'intérêt de la rendre.
   */
  clearReservation(transcriptionId: string): Promise<void>;
  findStalled(p: { now: Date; limit: number }): Promise<string[]>;
}

export const TRANSCRIPTION_QUEUE = Symbol('TranscriptionQueue');
