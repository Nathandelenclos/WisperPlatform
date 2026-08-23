import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Post,
  Res,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import type { ServerResponse } from 'node:http';

import type { Claimant } from '../../application/ports/worker-identities';
import { AppendTranscribedSegmentsUseCase } from '../../application/use-cases/append-transcribed-segments.use-case';
import { AssignSpeakersUseCase } from '../../application/use-cases/assign-speakers.use-case';
import { ClaimNextTranscriptionUseCase } from '../../application/use-cases/claim-next-transcription.use-case';
import { CompleteTranscriptionUseCase } from '../../application/use-cases/complete-transcription.use-case';
import { FailTranscriptionUseCase } from '../../application/use-cases/fail-transcription.use-case';
import { ReleaseTranscriptionRunUseCase } from '../../application/use-cases/release-transcription-run.use-case';
import { OpenMediaForRunUseCase } from '../../application/use-cases/open-media-for-run.use-case';
import { RenewTranscriptionLeaseUseCase } from '../../application/use-cases/renew-transcription-lease.use-case';
import { CurrentClaimant } from './claimant.decorator';
import {
  appendSegmentsBodySchema,
  assignSpeakersBodySchema,
  claimJobBodySchema,
  failJobBodySchema,
  jobReferenceBodySchema,
  mediaTokenSchema,
  runIdSchema,
} from './dto/worker-jobs.dto';
import { parseHttpInput } from './parse-http-input';
import { WorkerTokenGuard } from './worker-token.guard';

/**
 * Routes of the transcription worker. Nothing that transits here describes the user:
 * the media is served by short-lived token, with no file name.
 */
@UseGuards(WorkerTokenGuard)
@Controller('worker')
export class WorkerJobsController {
  constructor(
    // See TranscriptionsController: injection by explicit token, not by type metadata.
    @Inject(ClaimNextTranscriptionUseCase) private readonly claimNextTranscription: ClaimNextTranscriptionUseCase,
    @Inject(OpenMediaForRunUseCase) private readonly openMediaForRun: OpenMediaForRunUseCase,
    @Inject(AppendTranscribedSegmentsUseCase) private readonly appendSegments: AppendTranscribedSegmentsUseCase,
    @Inject(AssignSpeakersUseCase) private readonly assignSpeakers: AssignSpeakersUseCase,
    @Inject(RenewTranscriptionLeaseUseCase) private readonly renewLease: RenewTranscriptionLeaseUseCase,
    @Inject(CompleteTranscriptionUseCase) private readonly completeTranscription: CompleteTranscriptionUseCase,
    @Inject(FailTranscriptionUseCase) private readonly failTranscription: FailTranscriptionUseCase,
    @Inject(ReleaseTranscriptionRunUseCase) private readonly releaseRun: ReleaseTranscriptionRunUseCase,
  ) {}

  /**
   * The response is written by hand here: the contract distinguishes 200 (job assigned) from
   * 204 (nothing to do), which a status fixed by decorator cannot express.
   */
  @Post('jobs/claim')
  async claim(
    @CurrentClaimant() claimant: Claimant,
    @Body() body: unknown,
    @Res() response: ServerResponse,
  ): Promise<void> {
    const { workerId, models } = parseHttpInput(claimJobBodySchema, body);
    const job = await this.claimNextTranscription.execute({ claimant, workerId, models });

    if (job === null) {
      response.statusCode = HttpStatus.NO_CONTENT;
      response.end();
      return;
    }
    response.statusCode = HttpStatus.OK;
    response.setHeader('content-type', 'application/json; charset=utf-8');
    response.end(JSON.stringify(job));
  }

  @Get('media/:token')
  async media(@Param('token') token: string): Promise<StreamableFile> {
    const { stream, contentType, byteSize } = await this.openMediaForRun.execute({
      token: parseHttpInput(mediaTokenSchema, token),
    });
    return new StreamableFile(stream, { type: contentType, length: byteSize });
  }

  @Post('jobs/:runId/segments')
  @HttpCode(HttpStatus.NO_CONTENT)
  async appendTranscribedSegments(
    @Param('runId') runId: string,
    @Body() body: unknown,
  ): Promise<void> {
    const { transcriptionId, batchSequence, segments } = parseHttpInput(
      appendSegmentsBodySchema,
      body,
    );
    await this.appendSegments.execute({
      transcriptionId,
      runId: parseHttpInput(runIdSchema, runId),
      batchSequence,
      segments,
    });
  }

  /**
   * Diarization pass, optional: a worker that is not capable of it never calls this route and
   * behaves exactly as before.
   */
  @Post('jobs/:runId/speakers')
  @HttpCode(HttpStatus.NO_CONTENT)
  async assignSpeakersOfRun(@Param('runId') runId: string, @Body() body: unknown): Promise<void> {
    const { transcriptionId, turns } = parseHttpInput(assignSpeakersBodySchema, body);
    await this.assignSpeakers.execute({
      transcriptionId,
      runId: parseHttpInput(runIdSchema, runId),
      turns,
    });
  }

  @Post('jobs/:runId/heartbeat')
  @HttpCode(HttpStatus.OK)
  async heartbeat(
    @Param('runId') runId: string,
    @Body() body: unknown,
  ): Promise<{ leaseExpiresAt: Date }> {
    const { transcriptionId } = parseHttpInput(jobReferenceBodySchema, body);
    return this.renewLease.execute({
      transcriptionId,
      runId: parseHttpInput(runIdSchema, runId),
    });
  }

  @Post('jobs/:runId/complete')
  @HttpCode(HttpStatus.NO_CONTENT)
  async complete(@Param('runId') runId: string, @Body() body: unknown): Promise<void> {
    const { transcriptionId } = parseHttpInput(jobReferenceBodySchema, body);
    await this.completeTranscription.execute({
      transcriptionId,
      runId: parseHttpInput(runIdSchema, runId),
    });
  }

  @Post('jobs/:runId/fail')
  @HttpCode(HttpStatus.NO_CONTENT)
  async fail(@Param('runId') runId: string, @Body() body: unknown): Promise<void> {
    const { transcriptionId, reason } = parseHttpInput(failJobBodySchema, body);
    await this.failTranscription.execute({
      transcriptionId,
      runId: parseHttpInput(runIdSchema, runId),
      reason,
    });
  }

  /**
   * The worker shuts down and gives its attempt back: the request is requeued immediately,
   * instead of waiting for its lease to expire. This is not a failure, so no reason to give.
   */
  @Post('jobs/:runId/release')
  @HttpCode(HttpStatus.NO_CONTENT)
  async release(@Param('runId') runId: string, @Body() body: unknown): Promise<void> {
    const { transcriptionId } = parseHttpInput(jobReferenceBodySchema, body);
    await this.releaseRun.execute({
      transcriptionId,
      runId: parseHttpInput(runIdSchema, runId),
    });
  }
}
