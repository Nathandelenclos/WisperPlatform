import { Inject, Injectable } from '@nestjs/common';
import type { OnModuleDestroy, OnModuleInit } from '@nestjs/common';

import { LOGGER } from '../../application/ports/logger';
import type { Logger } from '../../application/ports/logger';
import { RequeueStalledTranscriptionsUseCase } from '../../application/use-cases/requeue-stalled-transcriptions.use-case';

/**
 * Intervalle de balayage des bails expirés. Plus court que le bail lui-même, pour qu'un
 * worker disparu soit remplacé peu après l'expiration.
 */
const SWEEP_INTERVAL_MS = 30_000;

/**
 * Déclencheur périodique de la remise en file. C'est un adaptateur entrant : il ne décide de
 * rien, il appelle le cas d'utilisation à intervalle fixe.
 *
 * ponytail: `setInterval` déréférencé suffit tant qu'une seule instance d'API tourne. Avec
 * plusieurs répliques, chacune balaiera : l'opération reste correcte (la réservation en base
 * est atomique) mais redondante. Plafond connu, à remplacer par un verrou d'avis Postgres
 * ou un ordonnanceur dédié le jour où l'API est répliquée.
 */
@Injectable()
export class StalledTranscriptionsScheduler implements OnModuleInit, OnModuleDestroy {
  private timer: NodeJS.Timeout | null = null;

  constructor(
    // Jeton explicite : voir TranscriptionsController.
    @Inject(RequeueStalledTranscriptionsUseCase)
    private readonly requeueStalled: RequeueStalledTranscriptionsUseCase,
    @Inject(LOGGER) private readonly logger: Logger,
  ) {}

  onModuleInit(): void {
    const timer = setInterval(() => {
      void this.sweep();
    }, SWEEP_INTERVAL_MS);
    // Déréférencé : ce minuteur ne doit jamais retarder l'arrêt du processus.
    timer.unref();
    this.timer = timer;
  }

  onModuleDestroy(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** Le cas d'utilisation journalise son propre bilan : ici on ne rattrape que l'échec. */
  private async sweep(): Promise<void> {
    try {
      await this.requeueStalled.execute();
    } catch (cause) {
      this.logger.error('balayage des bails expirés en échec', {
        cause: cause instanceof Error ? cause.name : typeof cause,
      });
    }
  }
}
