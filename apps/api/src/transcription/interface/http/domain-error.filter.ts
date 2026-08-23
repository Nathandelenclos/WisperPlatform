import { Catch, HttpException, HttpStatus, Inject } from '@nestjs/common';
import type { ArgumentsHost, ExceptionFilter } from '@nestjs/common';
import type { ServerResponse } from 'node:http';

import { MediaAccessDeniedError, TranscriptionNotFoundError } from '../../application/errors';
import { LOGGER } from '../../application/ports/logger';
import type { Logger } from '../../application/ports/logger';
import { DomainError } from '../../domain/errors';
import { WorkerKeyNotFoundError } from '../../../workers/application/errors';
import { WorkerDomainError } from '../../../workers/domain/errors';

/** The API's single error response. */
type ErrorResponse = { error: { code: string; message: string } };

type MappedFailure = {
  readonly status: number;
  readonly code: string;
  readonly message: string;
  /** True when the cause is not an expected refusal: it is logged at `error` level. */
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
 * Translates business refusals into HTTP codes and enforces the shape
 * `{ error: { code, message } }` on every error response, including those produced by the
 * framework. An unexpected cause never crosses the boundary: it becomes an opaque 500.
 *
 * Registered as `APP_FILTER`, it is the error boundary of the WHOLE platform: it therefore
 * knows the error bases of every bounded context, `workers` included. One base per context is
 * the price of the dependency rule — one domain does not import another's — and a second
 * catch-all filter would be worse: two global filters would fight over every error.
 */
@Catch()
export class DomainErrorFilter implements ExceptionFilter {
  constructor(@Inject(LOGGER) private readonly logger: Logger) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const failure = this.map(exception);
    const fields = { status: failure.status, code: failure.code };

    if (failure.unexpected) {
      this.logger.error('request rejected', {
        ...fields,
        cause: exception instanceof Error ? exception.name : typeof exception,
      });
    } else {
      this.logger.warn('request rejected', fields);
    }

    const response = host.switchToHttp().getResponse<ServerResponse>();
    if (response.writableEnded) {
      return;
    }
    if (response.headersSent) {
      // Stream already started (SSE, download): the body can no longer be replaced.
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
    if (
      exception instanceof TranscriptionNotFoundError ||
      exception instanceof WorkerKeyNotFoundError
    ) {
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
    if (exception instanceof DomainError || exception instanceof WorkerDomainError) {
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
      message: 'Internal error',
      unexpected: true,
    };
  }
}
