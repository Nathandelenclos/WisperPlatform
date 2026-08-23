import { toPlacement } from '../../domain/placement';
import { TranscriptionNotFoundError } from '../errors';
import { retryOnConcurrentWrite } from '../retry-on-concurrent-write';
import type { Clock } from '../ports/clock';
import type { TranscriptionEventPublisher } from '../ports/transcription-event-publisher';
import type { TranscriptionRepository } from '../ports/transcription-repository';
import { toTranscriptionView, type TranscriptionView } from '../views';

export type ChangePlacementCommand = {
  transcriptionId: string;
  ownerId: string;
  placement: string;
};

/**
 * Le propriétaire décide où sa demande sera calculée. C'est ce qui lui permet de rendre au
 * service une demande que sa machine, éteinte, laisse en attente — et la décision reste la
 * sienne : la plateforme ne rapatrie jamais rien d'elle-même.
 */
export class ChangePlacementUseCase {
  constructor(
    private readonly repository: TranscriptionRepository,
    private readonly publisher: TranscriptionEventPublisher,
    private readonly clock: Clock,
  ) {}

  async execute(command: ChangePlacementCommand): Promise<TranscriptionView> {
    const placement = toPlacement(command.placement);

    // Un worker peut réclamer la demande à l'instant même : le second essai repart d'une
    // lecture fraîche et refusera alors le déplacement, au lieu d'écraser son démarrage.
    return retryOnConcurrentWrite(async () => {
      const transcription = await this.repository.findById(command.transcriptionId);
      // Une transcription qui n'est pas la sienne est, pour lui, inexistante.
      if (transcription === null || transcription.ownerId !== command.ownerId) {
        throw new TranscriptionNotFoundError();
      }

      transcription.changePlacement({ placement, at: this.clock.now() });
      await this.repository.save(transcription);
      await this.publisher.publish(transcription.pullEvents());
      return toTranscriptionView(transcription.state());
    });
  }
}
