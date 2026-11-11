import { HttpException } from '@nestjs/common';
import type { ApiErrorCode } from '@portfolio/shared-types';

/** An HTTP error carrying a stable, client-facing error code. */
export class ApiException extends HttpException {
  constructor(
    status: number,
    readonly code: ApiErrorCode,
    message: string,
  ) {
    super(message, status);
  }
}
