import { ConcurrentTranscriptionWriteError } from './errors';

/**
 * An aggregate written by two actors from the same state has its second write refused by the
 * repository's optimistic lock. The platform's real collisions are brief and benign — the
 * expired-lease sweeper crosses a still-alive worker, two tabs correct the same segment — and
 * they settle by starting again from a fresh read.
 *
 * The attempt must therefore redo EVERYTHING: read again, decide, write. That is the reason we
 * take a function and not an already loaded transcription.
 *
 * ponytail: a single retry. Beyond that, the caller receives the conflict and turns it into a
 * 409; a queue per transcription would be the way out if contention became measurable.
 */
export async function retryOnConcurrentWrite<T>(attempt: () => Promise<T>): Promise<T> {
  try {
    return await attempt();
  } catch (error) {
    if (!(error instanceof ConcurrentTranscriptionWriteError)) {
      throw error;
    }
    return attempt();
  }
}
