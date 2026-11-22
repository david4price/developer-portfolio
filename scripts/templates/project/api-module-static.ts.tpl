import { Module } from '@nestjs/common';
import { __Pascal__Controller } from './__slug__.controller.js';
import { __CONST___REPOSITORY } from './__slug__.repository.js';
import { Static__Pascal__Repository } from './static-__slug__.repository.js';

/** __title__ (created by `pnpm new:project`): `GET /api/v1/__slug__/items`. */
@Module({
  controllers: [__Pascal__Controller],
  providers: [{ provide: __CONST___REPOSITORY, useFactory: () => new Static__Pascal__Repository() }],
})
export class __Pascal__Module {}
