import { Controller, Get, HttpStatus, Inject, Param, Query } from '@nestjs/common';
import { slug as slugSchema } from '@portfolio/project-registry';
import type { ProjectDetail, ProjectListResponse } from '@portfolio/shared-types';
import { ApiException } from '../../common/api-exception.js';
import { ZodValidationPipe } from '../../common/zod-validation.pipe.js';
import {
  encodeProjectCursor,
  type ListProjectsQuery,
  listProjectsQuerySchema,
} from './project-page.js';
import { PROJECTS_REPOSITORY, type ProjectsRepository } from './projects.repository.js';

@Controller('projects')
export class ProjectsController {
  constructor(@Inject(PROJECTS_REPOSITORY) private readonly repository: ProjectsRepository) {}

  @Get()
  async list(
    @Query(new ZodValidationPipe(listProjectsQuerySchema)) query: ListProjectsQuery,
  ): Promise<ProjectListResponse> {
    const page = await this.repository.listSummaries({ limit: query.limit, after: query.cursor });
    const last = page.items.at(-1);
    return {
      items: page.items,
      nextCursor: page.hasMore && last !== undefined ? encodeProjectCursor(last) : null,
    };
  }

  @Get(':slug')
  async get(
    @Param('slug', new ZodValidationPipe(slugSchema)) slug: string,
  ): Promise<ProjectDetail> {
    const project = await this.repository.findBySlug(slug);
    if (project === undefined) {
      throw new ApiException(HttpStatus.NOT_FOUND, 'not_found', 'Project not found');
    }
    return project;
  }
}
