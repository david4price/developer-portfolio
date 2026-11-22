import { Controller, Get, Inject, Query } from '@nestjs/common';
import type { __Pascal__ItemsResponse } from '@portfolio/shared-types';
import { z } from 'zod';
import { ZodValidationPipe } from '../../common/zod-validation.pipe.js';
import { __CONST___REPOSITORY, type __Pascal__Repository } from './__slug__.repository.js';

const listQuerySchema = z.object({ limit: z.coerce.number().int().min(1).max(50).default(20) });
type ListQuery = z.infer<typeof listQuerySchema>;

/** Thin by design: validate, ask the port, return the shared contract. */
@Controller('__slug__')
export class __Pascal__Controller {
  constructor(@Inject(__CONST___REPOSITORY) private readonly repository: __Pascal__Repository) {}

  @Get('items')
  async list(
    @Query(new ZodValidationPipe(listQuerySchema)) query: ListQuery,
  ): Promise<__Pascal__ItemsResponse> {
    return { items: await this.repository.list(query.limit) };
  }
}
