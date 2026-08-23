import type { TranscriptionEvent } from '../../domain/events';
import type {
  TranscriptionEventPublisher,
  TranscriptionEventStream,
} from '../../application/ports/transcription-event-publisher';

type Subscription = {
  readonly transcriptionId: string;
  readonly ownerId: string;
  readonly listener: (event: TranscriptionEvent) => void;
};

/**
 * Broadcast of domain events to the SSE subscribers.
 *
 * ponytail: accepted ceiling — the broadcast is local to the process. Two API instances behind
 * a load balancer do not see each other's events: a client subscribed on instance A will
 * receive nothing from a worker served by instance B. Way out without changing the ports:
 * replace this class with a Postgres `LISTEN/NOTIFY` adapter (`publish` →
 * `NOTIFY transcription_events, <payload>`, `subscribe` → dedicated client in `LISTEN`), the
 * `TranscriptionEventPublisher`/`TranscriptionEventStream` contract being already the right
 * boundary.
 */
export class InMemoryTranscriptionEvents implements TranscriptionEventPublisher, TranscriptionEventStream {
  private readonly subscriptions = new Set<Subscription>();

  async publish(events: readonly TranscriptionEvent[]): Promise<void> {
    for (const event of events) {
      for (const subscription of this.subscriptions) {
        if (
          subscription.transcriptionId !== event.transcriptionId ||
          subscription.ownerId !== event.ownerId
        ) {
          continue;
        }
        // A subscriber that throws (socket closed between two writes) must neither interrupt
        // the broadcast to the others, nor make the use case that has just saved fail.
        try {
          subscription.listener(event);
        } catch {
          this.subscriptions.delete(subscription);
        }
      }
    }
  }

  subscribe(
    p: { transcriptionId: string; ownerId: string },
    listener: (event: TranscriptionEvent) => void,
  ): () => void {
    const subscription: Subscription = {
      transcriptionId: p.transcriptionId,
      ownerId: p.ownerId,
      listener,
    };
    this.subscriptions.add(subscription);
    return () => {
      this.subscriptions.delete(subscription);
    };
  }
}
