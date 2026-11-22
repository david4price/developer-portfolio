import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { ApiErrorResponse, __Pascal__Item, __Pascal__ItemsResponse } from '@portfolio/shared-types';
import { __Pascal__Controller } from '../src/modules/__slug__/__slug__.controller.js';
import {
  __CONST___REPOSITORY,
  type __Pascal__Repository,
} from '../src/modules/__slug__/__slug__.repository.js';
import { createTestApp } from './support/test-app.js';

class InMemory__Pascal__Repository implements __Pascal__Repository {
  readonly limits: number[] = [];
  constructor(private readonly items: readonly __Pascal__Item[]) {}
  async list(limit: number): Promise<readonly __Pascal__Item[]> {
    this.limits.push(limit);
    return this.items.slice(0, limit);
  }
}

describe('__slug__ items', () => {
  let app: NestFastifyApplication;
  const repository = new InMemory__Pascal__Repository([
    { id: 'a', name: 'Alpha', createdAt: '2026-01-02T00:00:00.000Z' },
    { id: 'b', name: 'Beta', createdAt: '2026-01-01T00:00:00.000Z' },
  ]);

  before(async () => {
    app = await createTestApp({
      controllers: [__Pascal__Controller],
      providers: [{ provide: __CONST___REPOSITORY, useValue: repository }],
    });
  });
  after(async () => {
    await app?.close();
  });

  it('lists items, 20 by default', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/v1/__slug__/items' });
    assert.equal(response.statusCode, 200);
    assert.equal(response.json<__Pascal__ItemsResponse>().items.length, 2);
    assert.equal(repository.limits.at(-1), 20);
  });

  it('rejects a limit outside 1-50 with a typed 400', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/v1/__slug__/items?limit=500' });
    assert.equal(response.statusCode, 400);
    assert.equal(response.json<ApiErrorResponse>().error.code, 'bad_request');
  });
});
