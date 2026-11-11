import { Module } from '@nestjs/common';
import { DATABASE } from '../../database/database.module.js';
import type { Database } from '../../database/database.js';
import { DrizzleProjectsRepository } from './drizzle-projects.repository.js';
import { ProjectsController } from './projects.controller.js';
import { PROJECTS_REPOSITORY } from './projects.repository.js';

@Module({
  controllers: [ProjectsController],
  providers: [
    {
      provide: PROJECTS_REPOSITORY,
      inject: [DATABASE],
      useFactory: (database: Database) => new DrizzleProjectsRepository(database),
    },
  ],
})
export class ProjectsModule {}
