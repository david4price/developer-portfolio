import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { ApiErrorCode, ApiErrorResponse } from '@portfolio/shared-types';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { ApiException } from './api-exception.js';
import { ClientDisconnectedError } from './client-disconnected.error.js';
import { DependencyUnavailableError } from './dependency-unavailable.error.js';

/** Non-standard "client closed request" status (as in nginx logs); the client never sees it. */
const CLIENT_CLOSED_REQUEST = 499;

const codeByStatus: Readonly<Record<number, ApiErrorCode>> = {
  [HttpStatus.BAD_REQUEST]: 'bad_request',
  [HttpStatus.NOT_FOUND]: 'not_found',
  [HttpStatus.TOO_MANY_REQUESTS]: 'rate_limited',
  [HttpStatus.SERVICE_UNAVAILABLE]: 'not_ready',
};

/**
 * Renders every error as an `ApiErrorResponse`. Dependency outages become a retryable
 * `503 not_ready`; unexpected errors are logged with the request id and returned as a generic 500
 * so internal details never reach clients.
 */
@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('ApiExceptionFilter');

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<FastifyRequest>();
    const reply = http.getResponse<FastifyReply>();

    let status: number = HttpStatus.INTERNAL_SERVER_ERROR;
    let code: ApiErrorCode = 'internal_error';
    let message = 'Internal server error';

    if (exception instanceof ClientDisconnectedError) {
      // Routine (a visitor closed the tab): not an error, and there's no one to answer.
      this.logger.debug({ message: 'Client disconnected', requestId: request.id });
      void reply.status(CLIENT_CLOSED_REQUEST).send();
      return;
    }
    if (exception instanceof DependencyUnavailableError) {
      status = HttpStatus.SERVICE_UNAVAILABLE;
      code = 'not_ready';
      message = 'Service temporarily unavailable';
      this.logger.warn({
        message: 'Dependency unavailable',
        requestId: request.id,
        dependency: exception.dependency,
      });
    } else if (exception instanceof ApiException) {
      status = exception.getStatus();
      code = exception.code;
      message = exception.message;
      if (exception.retryAfterSeconds !== undefined) {
        void reply.header(
          'retry-after',
          String(Math.max(1, Math.ceil(exception.retryAfterSeconds))),
        );
      }
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      code = codeByStatus[status] ?? (status < 500 ? 'bad_request' : 'internal_error');
      message = status < 500 ? exception.message : message;
    } else {
      this.logger.error({
        message: 'Unhandled error',
        requestId: request.id,
        error: exception instanceof Error ? exception.stack : String(exception),
      });
    }

    const body: ApiErrorResponse = { error: { code, message, requestId: request.id ?? null } };
    void reply.status(status).send(body);
  }
}
