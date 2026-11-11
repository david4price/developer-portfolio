import { HttpStatus, type PipeTransform } from '@nestjs/common';
import type { z } from 'zod';
import { ApiException } from './api-exception.js';

/** Validates a controller input against a zod schema and returns the parsed value. */
export class ZodValidationPipe<Schema extends z.ZodType> implements PipeTransform {
  constructor(private readonly schema: Schema) {}

  transform(value: unknown): z.infer<Schema> {
    const result = this.schema.safeParse(value);
    if (result.success) return result.data;

    const detail = result.error.issues[0]?.message ?? 'invalid input';
    throw new ApiException(HttpStatus.BAD_REQUEST, 'bad_request', `Invalid input: ${detail}`);
  }
}
