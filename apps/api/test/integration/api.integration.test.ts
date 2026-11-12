import 'reflect-metadata';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { NestFactory } from '@nestjs/core';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { registry } from '@portfolio/project-registry';
import type { ProjectListResponse } from '@portfolio/shared-types';
import { AppModule } from '../../src/app.module.js';
import { configureApp, createFastifyAdapter } from '../../src/app.setup.js';
import { loadApiConfig } from '../../src/config/api-config.js';

/**
 * Runs the full application against real PostgreSQL and Redis. Expects `pnpm db:migrate` and
 * `pnpm db:seed` to have run first (CI does this with service containers). Skipped when
 * DATABASE_URL or REDIS_URL is unset.
 */
const configured = Boolean(process.env.DATABASE_URL && process.env.REDIS_URL);

describe(
  'api integration',
  { skip: !configured && 'DATABASE_URL and REDIS_URL are not set' },
  () => {
    let app: NestFastifyApplication;

    before(async () => {
      const config = loadApiConfig();
      app = await NestFactory.create<NestFastifyApplication>(
        AppModule.register(config),
        createFastifyAdapter(),
        { logger: false },
      );
      configureApp(app, config);
      await app.init();
      await app.getHttpAdapter().getInstance().ready();
    });

    after(async () => {
      await app?.close();
    });

    it('is ready when PostgreSQL and Redis are reachable', async () => {
      const response = await app.inject({ method: 'GET', url: '/api/v1/health/ready' });
      assert.equal(response.statusCode, 200, response.body);
      assert.deepEqual(response.json(), {
        status: 'ready',
        checks: { postgres: 'up', redis: 'up' },
      });
    });

    it('serves the seeded registry projects from PostgreSQL', async () => {
      const response = await app.inject({ method: 'GET', url: '/api/v1/projects' });
      assert.equal(response.statusCode, 200);

      const body = response.json<ProjectListResponse>();
      const slugs = body.items.map((item) => item.slug);
      assert.deepEqual([...slugs].sort(), registry.projects.map((project) => project.slug).sort());
      assert.equal(body.nextCursor, null);
      assert.equal((body.items[0] as Record<string, unknown> | undefined)?.description, undefined);
    });

    it('pages through PostgreSQL with the keyset cursor in the same order', async () => {
      const full = await app.inject({ method: 'GET', url: '/api/v1/projects?limit=50' });
      const expected = full.json<ProjectListResponse>().items.map((item) => item.slug);

      for (const limit of [1, 2]) {
        const seen: string[] = [];
        let cursor: string | null = null;
        do {
          const url: string = `/api/v1/projects?limit=${limit}${cursor === null ? '' : `&cursor=${cursor}`}`;
          const response = await app.inject({ method: 'GET', url });
          assert.equal(response.statusCode, 200, response.body);
          const page = response.json<ProjectListResponse>();
          seen.push(...page.items.map((item) => item.slug));
          cursor = page.nextCursor;
        } while (cursor !== null);
        assert.deepEqual(seen, expected, `limit=${limit}`);
      }
    });
  },
);
