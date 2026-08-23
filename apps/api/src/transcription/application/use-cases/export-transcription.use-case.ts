import type { SubtitleFormat } from '../../domain/subtitle-document';
import { TranscriptionNotFoundError } from '../errors';
import type { TranscriptionRepository } from '../ports/transcription-repository';

const CONTENT_TYPES: Record<SubtitleFormat, string> = {
  srt: 'application/x-subrip; charset=utf-8',
  vtt: 'text/vtt; charset=utf-8',
  txt: 'text/plain; charset=utf-8',
};

export type ExportTranscriptionCommand = {
  transcriptionId: string;
  ownerId: string;
  format: SubtitleFormat;
};

export type ExportedTranscription = { filename: string; contentType: string; body: string };

export class ExportTranscriptionUseCase {
  constructor(private readonly repository: TranscriptionRepository) {}

  async execute(command: ExportTranscriptionCommand): Promise<ExportedTranscription> {
    const transcription = await this.repository.findById(command.transcriptionId);
    if (transcription === null || transcription.ownerId !== command.ownerId) {
      throw new TranscriptionNotFoundError();
    }

    // The downloaded file reuses the media name, original extension replaced by the format.
    const name = transcription.media.originalName;
    const lastDot = name.lastIndexOf('.');
    const stem = lastDot > 0 ? name.slice(0, lastDot) : name;

    return {
      filename: `${stem}.${command.format}`,
      contentType: CONTENT_TYPES[command.format],
      body: transcription.render(command.format),
    };
  }
}
