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
 * Diffusion des événements de domaine vers les abonnés SSE.
 *
 * ponytail: plafond assumé — la diffusion est locale au processus. Deux instances d'API
 * derrière un répartiteur ne voient pas les événements l'une de l'autre : un client abonné
 * sur l'instance A ne recevra rien d'un worker servi par l'instance B. Chemin de sortie sans
 * changer les ports : remplacer cette classe par un adaptateur Postgres `LISTEN/NOTIFY`
 * (`publish` → `NOTIFY transcription_events, <payload>`, `subscribe` → client dédié en
 * `LISTEN`), le contrat `TranscriptionEventPublisher`/`TranscriptionEventStream` étant déjà
 * la bonne frontière.
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
        // Un abonné qui jette (socket fermée entre deux écritures) ne doit ni interrompre
        // la diffusion aux autres, ni faire échouer le use case qui vient de sauvegarder.
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
