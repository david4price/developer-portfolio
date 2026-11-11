import { Controller, Get, HttpStatus, Inject, Param } from '@nestjs/common';
import { slug as slugSchema, toProjectSummary } from '@portfolio/project-registry';
import type { ProjectDetail, ProjectListResponse } from '@portfolio/shared-types';
import { ApiException } from '../../common/api-exception.js';
import { ZodValidationPipe } from '../../common/zod-validation.pipe.js';
import { PROJECTS_REPOSITORY, type ProjectsRepository } from './projects.repository.js';

@Controller('projects')
export class ProjectsController {
  constructor(@Inject(PROJECTS_REPOSITORY) private readonly repository: ProjectsRepository) {}

  @Get()
  async list(): Promise<ProjectListResponse> {
    const items = await this.repository.list();
    return { items: items.map(toProjectSummary) };
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
