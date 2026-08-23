import type { TranscriptionEventPublisher } from '../../src/transcription/application/ports/transcription-event-publisher';
import type { TranscriptionEvent } from '../../src/transcription/domain/events';

/** Keeps every published event, in order: this is the witness of the acceptance tests. */
export class RecordingEventPublisher implements TranscriptionEventPublisher {
  readonly published: TranscriptionEvent[] = [];

  async publish(events: readonly TranscriptionEvent[]): Promise<void> {
    this.published.push(...events);
  }

  names(): string[] {
    return this.published.map((event) => event.name);
  }

  clear(): void {
    this.published.length = 0;
  }
}
