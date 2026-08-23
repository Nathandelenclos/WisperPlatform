import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  Res,
  Sse,
  StreamableFile,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import type { MessageEvent } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { unlink } from 'node:fs/promises';
import type { ServerResponse } from 'node:http';
import { Observable } from 'rxjs';

import type { AuthenticatedUser } from '../../../auth/application/ports/authentication';
import { CurrentUser } from '../../../auth/interface/current-user.decorator';
import { SessionGuard } from '../../../auth/interface/session.guard';
import { LOGGER } from '../../application/ports/logger';
import type { Logger } from '../../application/ports/logger';
import type { TranscriptionSummary } from '../../application/ports/transcription-catalog';
import { TRANSCRIPTION_EVENT_STREAM } from '../../application/ports/transcription-event-publisher';
import type { TranscriptionEventStream } from '../../application/ports/transcription-event-publisher';
import { ChangePlacementUseCase } from '../../application/use-cases/change-placement.use-case';
import { CorrectSegmentUseCase } from '../../application/use-cases/correct-segment.use-case';
import { ExportTranscriptionUseCase } from '../../application/use-cases/export-transcription.use-case';
import { GetTranscriptionUseCase } from '../../application/use-cases/get-transcription.use-case';
import { ListTranscriptionsUseCase } from '../../application/use-cases/list-transcriptions.use-case';
import { OpenOwnedMediaUseCase } from '../../application/use-cases/open-owned-media.use-case';
import { RenameSpeakerUseCase } from '../../application/use-cases/rename-speaker.use-case';
import { RequestTranscriptionUseCase } from '../../application/use-cases/request-transcription.use-case';
import type { TranscriptionView } from '../../application/views';
import { contentDisposition } from './content-disposition';
import {
  changePlacementBodySchema,
  correctSegmentBodySchema,
  correctSegmentParamsSchema,
  exportQuerySchema,
  renameSpeakerBodySchema,
  renameSpeakerParamsSchema,
  requestTranscriptionBodySchema,
  transcriptionIdSchema,
} from './dto/transcriptions.dto';
import type { UploadedMediaFile } from './dto/transcriptions.dto';
import { parseHttpInput } from './parse-http-input';

/**
 * User routes. The controller does exactly three things: validate the transport input, call a
 * use case, and shape the response. Dates are serialised to ISO 8601 by `JSON.stringify`,
 * which is exactly the format the contract expects.
 */
@UseGuards(SessionGuard)
@Controller('transcriptions')
export class TranscriptionsController {
  constructor(
    // Explicit injection tokens: the development transpiler (tsx/esbuild) does not emit
    // `design:paramtypes`, so constructor injection by type cannot be implicit.
    @Inject(RequestTranscriptionUseCase) private readonly requestTranscription: RequestTranscriptionUseCase,
    @Inject(ListTranscriptionsUseCase) private readonly listTranscriptions: ListTranscriptionsUseCase,
    @Inject(GetTranscriptionUseCase) private readonly getTranscription: GetTranscriptionUseCase,
    @Inject(CorrectSegmentUseCase) private readonly correctSegment: CorrectSegmentUseCase,
    @Inject(RenameSpeakerUseCase) private readonly renameSpeaker: RenameSpeakerUseCase,
    @Inject(ChangePlacementUseCase) private readonly changePlacement: ChangePlacementUseCase,
    @Inject(ExportTranscriptionUseCase) private readonly exportTranscription: ExportTranscriptionUseCase,
    @Inject(OpenOwnedMediaUseCase) private readonly openOwnedMedia: OpenOwnedMediaUseCase,
    @Inject(TRANSCRIPTION_EVENT_STREAM) private readonly events: TranscriptionEventStream,
    @Inject(LOGGER) private readonly logger: Logger,
  ) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(FileInterceptor('file'))
  async request(
    @CurrentUser() user: AuthenticatedUser,
    @UploadedFile() file: UploadedMediaFile | undefined,
    @Body() body: unknown,
  ): Promise<{ id: string }> {
    if (file === undefined) {
      throw new BadRequestException('The "file" multipart part is required');
    }
    try {
      const { model, language, placement } = parseHttpInput(requestTranscriptionBodySchema, body);
      const { transcriptionId } = await this.requestTranscription.execute({
        ownerId: user.id,
        media: {
          tempPath: file.path,
          originalName: file.originalname,
          contentType: file.mimetype,
          byteSize: file.size,
        },
        model,
        language,
        placement,
      });
      return { id: transcriptionId };
    } catch (failure) {
      // The media was not adopted by the store: the incoming file must not be left behind.
      await this.discardUpload(file.path);
      throw failure;
    }
  }

  @Get()
  list(@CurrentUser() user: AuthenticatedUser): Promise<TranscriptionSummary[]> {
    return this.listTranscriptions.execute({ ownerId: user.id });
  }

  @Get(':id')
  get(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<TranscriptionView> {
    return this.getTranscription.execute({
      transcriptionId: parseHttpInput(transcriptionIdSchema, id),
      ownerId: user.id,
    });
  }

  @Sse(':id/events')
  async events$(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<Observable<MessageEvent>> {
    const transcriptionId = parseHttpInput(transcriptionIdSchema, id);
    // Refuse the stream before opening it if the transcription does not belong to the caller.
    await this.getTranscription.execute({ transcriptionId, ownerId: user.id });

    return new Observable<MessageEvent>((subscriber) =>
      this.events.subscribe({ transcriptionId, ownerId: user.id }, (event) => {
        subscriber.next({ data: event });
      }),
    );
  }

  @Patch(':id/segments/:ordinal')
  @HttpCode(HttpStatus.NO_CONTENT)
  async correct(
    @CurrentUser() user: AuthenticatedUser,
    @Param() params: unknown,
    @Body() body: unknown,
  ): Promise<void> {
    const { id, ordinal } = parseHttpInput(correctSegmentParamsSchema, params);
    const { text } = parseHttpInput(correctSegmentBodySchema, body);
    await this.correctSegment.execute({
      transcriptionId: id,
      ownerId: user.id,
      ordinal,
      text,
    });
  }

  /**
   * Naming a speaker returns the up-to-date transcription: the rename touches all of its lines
   * at once, so the caller needs the whole view, not an acknowledgement.
   */
  @Patch(':id/speakers/:index')
  @HttpCode(HttpStatus.OK)
  async rename(
    @CurrentUser() user: AuthenticatedUser,
    @Param() params: unknown,
    @Body() body: unknown,
  ): Promise<TranscriptionView> {
    const { id, index } = parseHttpInput(renameSpeakerParamsSchema, params);
    const { name } = parseHttpInput(renameSpeakerBodySchema, body);
    return this.renameSpeaker.execute({
      transcriptionId: id,
      ownerId: user.id,
      index,
      name,
    });
  }

  /**
   * The owner chooses where their request will be computed, and that is what lets them hand
   * back to the service a request their own machine leaves pending. Returns the whole view:
   * the library displays the new placement without re-reading.
   */
  @Patch(':id/placement')
  @HttpCode(HttpStatus.OK)
  async place(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<TranscriptionView> {
    const { placement } = parseHttpInput(changePlacementBodySchema, body);
    return this.changePlacement.execute({
      transcriptionId: parseHttpInput(transcriptionIdSchema, id),
      ownerId: user.id,
      placement,
    });
  }

  @Get(':id/export')
  async export(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Query() query: unknown,
    @Res({ passthrough: true }) response: ServerResponse,
  ): Promise<string> {
    const { format } = parseHttpInput(exportQuerySchema, query);
    const { filename, contentType, body } = await this.exportTranscription.execute({
      transcriptionId: parseHttpInput(transcriptionIdSchema, id),
      ownerId: user.id,
      format,
    });
    response.setHeader('content-type', contentType);
    response.setHeader('content-disposition', contentDisposition('attachment', filename));
    return body;
  }

  @Get(':id/media')
  async media(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<StreamableFile> {
    const { stream, contentType, byteSize, filename } = await this.openOwnedMedia.execute({
      transcriptionId: parseHttpInput(transcriptionIdSchema, id),
      ownerId: user.id,
    });
    return new StreamableFile(stream, {
      type: contentType,
      length: byteSize,
      disposition: contentDisposition('inline', filename),
    });
  }

  private async discardUpload(path: string): Promise<void> {
    try {
      await unlink(path);
    } catch (cause) {
      this.logger.warn('incoming file not deleted', {
        cause: cause instanceof Error ? cause.name : typeof cause,
      });
    }
  }
}
