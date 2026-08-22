import { Catch, HttpException, HttpStatus, Inject } from '@nestjs/common';
import type { ArgumentsHost, ExceptionFilter } from '@nestjs/common';
import type { ServerResponse } from 'node:http';

import { MediaAccessDeniedError, TranscriptionNotFoundError } from '../../application/errors';
import { LOGGER } from '../../application/ports/logger';
import type { Logger } from '../../application/ports/logger';
import { DomainError } from '../../domain/errors';

/** Réponse d'erreur unique de l'API. */
type ErrorResponse = { error: { code: string; message: string } };

type MappedFailure = {
  readonly status: number;
  readonly code: string;
  readonly message: string;
  /** Vrai quand la cause n'est pas un refus attendu : elle est journalisée en `error`. */
  readonly unexpected: boolean;
};

const HTTP_CODES: Readonly<Record<number, string>> = {
  [HttpStatus.BAD_REQUEST]: 'INVALID_REQUEST',
  [HttpStatus.UNAUTHORIZED]: 'UNAUTHENTICATED',
  [HttpStatus.FORBIDDEN]: 'FORBIDDEN',
  [HttpStatus.NOT_FOUND]: 'NOT_FOUND',
  [HttpStatus.METHOD_NOT_ALLOWED]: 'METHOD_NOT_ALLOWED',
  [HttpStatus.PAYLOAD_TOO_LARGE]: 'PAYLOAD_TOO_LARGE',
  [HttpStatus.UNSUPPORTED_MEDIA_TYPE]: 'UNSUPPORTED_MEDIA_TYPE',
  [HttpStatus.UNPROCESSABLE_ENTITY]: 'UNPROCESSABLE_ENTITY',
  [HttpStatus.TOO_MANY_REQUESTS]: 'TOO_MANY_REQUESTS',
};

/**
 * Traduit les refus métier en codes HTTP et impose la forme `{ error: { code, message } }`
 * à toutes les réponses d'erreur, y compris celles produites par le framework.
 * Une cause inattendue ne franchit jamais la frontière : elle devient un 500 opaque.
 */
@Catch()
export class DomainErrorFilter implements ExceptionFilter {
  constructor(@Inject(LOGGER) private readonly logger: Logger) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const failure = this.map(exception);
    const fields = { status: failure.status, code: failure.code };

    if (failure.unexpected) {
      this.logger.error('requête rejetée', {
        ...fields,
        cause: exception instanceof Error ? exception.name : typeof exception,
      });
    } else {
      this.logger.warn('requête rejetée', fields);
    }

    const response = host.switchToHttp().getResponse<ServerResponse>();
    if (response.writableEnded) {
      return;
    }
    if (response.headersSent) {
      // Flux déjà engagé (SSE, téléchargement) : impossible de remplacer le corps.
      response.end();
      return;
    }

    const body: ErrorResponse = {
      error: { code: failure.code, message: failure.message },
    };
    response.statusCode = failure.status;
    response.setHeader('content-type', 'application/json; charset=utf-8');
    response.end(JSON.stringify(body));
  }

  private map(exception: unknown): MappedFailure {
    if (exception instanceof TranscriptionNotFoundError) {
      return {
        status: HttpStatus.NOT_FOUND,
        code: exception.code,
        message: exception.message,
        unexpected: false,
      };
    }
    if (exception instanceof MediaAccessDeniedError) {
      return {
        status: HttpStatus.FORBIDDEN,
        code: exception.code,
        message: exception.message,
        unexpected: false,
      };
    }
    if (exception instanceof DomainError) {
      return {
        status: HttpStatus.UNPROCESSABLE_ENTITY,
        code: exception.code,
        message: exception.message,
        unexpected: false,
      };
    }
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      return {
        status,
        code: HTTP_CODES[status] ?? 'HTTP_ERROR',
        message: exception.message,
        unexpected: status >= HttpStatus.INTERNAL_SERVER_ERROR,
      };
    }
    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      code: 'INTERNAL_ERROR',
      message: 'Erreur interne',
      unexpected: true,
    };
  }
}
