import { Module } from '@nestjs/common';
import { DATABASE } from '../../database/database.module.js';
import type { Database } from '../../database/database.js';
import { __Pascal__Controller } from './__slug__.controller.js';
import { __CONST___REPOSITORY } from './__slug__.repository.js';
import { Drizzle__Pascal__Repository } from './drizzle-__slug__.repository.js';

/** __title__ (created by `pnpm new:project`): `GET /api/v1/__slug__/items` from PostgreSQL. */
@Module({
  controllers: [__Pascal__Controller],
  providers: [
    {
      provide: __CONST___REPOSITORY,
      inject: [DATABASE],
      useFactory: (database: Database) => new Drizzle__Pascal__Repository(database),
    },
  ],
})
export class __Pascal__Module {}
