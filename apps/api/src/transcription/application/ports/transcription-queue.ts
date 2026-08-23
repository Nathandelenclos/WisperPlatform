import type { WhisperModel } from '../../domain/transcription-settings';
import type { Claimant } from './worker-identities';

export interface TranscriptionQueue {
  /**
   * Atomic reservation of a pending transcription whose model is served by the worker.
   * Purely technical: it prevents two workers from loading the same aggregate and expires on
   * its own after `reservationSeconds`. Returns the reserved id, or `null` if there is nothing.
   *
   * The claimant bounds what may be offered, and this partitioning is absolute:
   * - `service` sees ONLY transcriptions with placement `service`;
   * - `owner` sees ONLY transcriptions with placement `owner` that it owns.
   *
   * No crossing over, in either direction: a request placed on its owner's machine is never
   * served to the service, even if it has been waiting for a long time, and a request from the
   * service is never served to a user machine.
   */
  reserveNextPending(p: {
    claimant: Claimant;
    workerId: string;
    models: readonly WhisperModel[];
    reservationSeconds: number;
    now: Date;
  }): Promise<string | null>;

  /** Ids of the in-progress transcriptions whose lease has expired. */
  /**
   * Lifts the technical reservation set by `reserveNextPending`. Releasing a run without this
   * leaves the request invisible for the whole reservation window: it really is `pending`, but
   * no worker gets offered it, which cancels the entire point of releasing it.
   */
  clearReservation(transcriptionId: string): Promise<void>;
  findStalled(p: { now: Date; limit: number }): Promise<string[]>;
}

export const TRANSCRIPTION_QUEUE = Symbol('TranscriptionQueue');
