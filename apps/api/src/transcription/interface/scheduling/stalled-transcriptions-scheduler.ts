import { Inject, Injectable } from '@nestjs/common';
import type { OnModuleDestroy, OnModuleInit } from '@nestjs/common';

import { LOGGER } from '../../application/ports/logger';
import type { Logger } from '../../application/ports/logger';
import { RequeueStalledTranscriptionsUseCase } from '../../application/use-cases/requeue-stalled-transcriptions.use-case';

/**
 * Sweep interval for expired leases. Shorter than the lease itself, so that a vanished worker
 * is replaced shortly after expiry.
 */
const SWEEP_INTERVAL_MS = 30_000;

/**
 * Periodic trigger of the requeue. This is an inbound adapter: it decides nothing, it calls
 * the use case at a fixed interval.
 *
 * ponytail: an unref'd `setInterval` is enough as long as a single API instance runs. With
 * several replicas, each one will sweep: the operation stays correct (the reservation in the
 * database is atomic) but redundant. Known ceiling, to be replaced by a Postgres advisory
 * lock or a dedicated scheduler the day the API is replicated.
 */
@Injectable()
export class StalledTranscriptionsScheduler implements OnModuleInit, OnModuleDestroy {
  private timer: NodeJS.Timeout | null = null;

  constructor(
    // Explicit token: see TranscriptionsController.
    @Inject(RequeueStalledTranscriptionsUseCase)
    private readonly requeueStalled: RequeueStalledTranscriptionsUseCase,
    @Inject(LOGGER) private readonly logger: Logger,
  ) {}

  onModuleInit(): void {
    const timer = setInterval(() => {
      void this.sweep();
    }, SWEEP_INTERVAL_MS);
    // Unref'd: this timer must never delay the shutdown of the process.
    timer.unref();
    this.timer = timer;
  }

  onModuleDestroy(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** The use case logs its own tally: here we only catch the failure. */
  private async sweep(): Promise<void> {
    try {
      await this.requeueStalled.execute();
    } catch (cause) {
      this.logger.error('expired lease sweep failed', {
        cause: cause instanceof Error ? cause.name : typeof cause,
      });
    }
  }
}
