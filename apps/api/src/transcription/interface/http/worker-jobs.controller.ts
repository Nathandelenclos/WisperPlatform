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

import { AppendTranscribedSegmentsUseCase } from '../../application/use-cases/append-transcribed-segments.use-case';
import { AssignSpeakersUseCase } from '../../application/use-cases/assign-speakers.use-case';
import { ClaimNextTranscriptionUseCase } from '../../application/use-cases/claim-next-transcription.use-case';
import { CompleteTranscriptionUseCase } from '../../application/use-cases/complete-transcription.use-case';
import { FailTranscriptionUseCase } from '../../application/use-cases/fail-transcription.use-case';
import { ReleaseTranscriptionRunUseCase } from '../../application/use-cases/release-transcription-run.use-case';
import { OpenMediaForRunUseCase } from '../../application/use-cases/open-media-for-run.use-case';
import { RenewTranscriptionLeaseUseCase } from '../../application/use-cases/renew-transcription-lease.use-case';
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
 * Routes du worker de transcription. Rien de ce qui transite ici ne décrit l'utilisateur :
 * le média est servi par jeton à durée de vie courte, sans nom de fichier.
 */
@UseGuards(WorkerTokenGuard)
@Controller('worker')
export class WorkerJobsController {
  constructor(
    // Voir TranscriptionsController : injection par jeton explicite, pas par métadonnée de type.
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
   * La réponse est écrite ici : le contrat distingue 200 (job attribué) de 204 (rien à faire),
   * ce qu'un statut fixé par décorateur ne permet pas d'exprimer.
   */
  @Post('jobs/claim')
  async claim(@Body() body: unknown, @Res() response: ServerResponse): Promise<void> {
    const { workerId, models } = parseHttpInput(claimJobBodySchema, body);
    const job = await this.claimNextTranscription.execute({ workerId, models });

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
   * Passe de diarisation, optionnelle : un worker qui n'en est pas capable n'appelle jamais
   * cette route et se comporte exactement comme avant.
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
   * Le worker s'arrête et rend sa tentative : la demande repart en file immédiatement, au lieu
   * d'attendre l'extinction de son bail. Ce n'est pas un échec, donc pas de raison à fournir.
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
