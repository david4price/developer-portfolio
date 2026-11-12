import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { after, before, describe, it } from 'node:test';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type pg from 'pg';
import { DependencyUnavailableError } from '../src/common/dependency-unavailable.error.js';
import { isDatabaseUnavailableError, withDatabase } from '../src/database/database-errors.js';
import { createDatabase, createPool } from '../src/database/database.js';
import { DrizzleProjectsRepository } from '../src/modules/projects/drizzle-projects.repository.js';
import { ProjectsController } from '../src/modules/projects/projects.controller.js';
import {
  PROJECTS_REPOSITORY,
  type ProjectsRepository,
} from '../src/modules/projects/projects.repository.js';
import { createTestApp } from './support/test-app.js';

function withCode(message: string, code: string): Error {
  return Object.assign(new Error(message), { code });
}

/** A loopback port that was just free, so connecting to it is refused. */
async function closedPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address !== null && typeof address === 'object');
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  return address.port;
}

describe('isDatabaseUnavailableError', () => {
  const unavailable: readonly [string, unknown][] = [
    ['connection refused', withCode('connect ECONNREFUSED', 'ECONNREFUSED')],
    ['DNS failure', withCode('getaddrinfo ENOTFOUND', 'ENOTFOUND')],
    ['server starting up', withCode('the database system is starting up', '57P03')],
    ['connection exception class', withCode('connection failure', '08006')],
    ['too many connections', withCode('too many clients', '53300')],
    ['pool connect timeout', new Error('timeout exceeded when trying to connect')],
    ['dropped connection', new Error('Connection terminated unexpectedly')],
    [
      'Drizzle-wrapped driver error',
      new Error('Failed query: select 1', { cause: withCode('refused', 'ECONNREFUSED') }),
    ],
    [
      'dual-stack connect failure',
      new AggregateError([withCode('refused', 'ECONNREFUSED')], 'connect failed'),
    ],
  ];

  for (const [label, error] of unavailable) {
    it(`treats ${label} as an outage`, () => {
      assert.equal(isDatabaseUnavailableError(error), true);
    });
  }

  const notUnavailable: readonly [string, unknown][] = [
    ['a syntax error', withCode('syntax error at or near', '42601')],
    ['a unique violation', withCode('duplicate key value', '23505')],
    ['a plain error', new Error('boom')],
    ['a non-error value', 'ECONNREFUSED'],
  ];

  for (const [label, error] of notUnavailable) {
    it(`does not treat ${label} as an outage`, () => {
      assert.equal(isDatabaseUnavailableError(error), false);
    });
  }

  it('withDatabase translates outages and rethrows other errors unchanged', async () => {
    const outage = withCode('refused', 'ECONNREFUSED');
    await assert.rejects(
      withDatabase(() => Promise.reject(outage)),
      (error: unknown) =>
        error instanceof DependencyUnavailableError &&
        error.dependency === 'postgres' &&
        error.cause === outage,
    );

    const bug = withCode('syntax error', '42601');
    await assert.rejects(
      withDatabase(() => Promise.reject(bug)),
      (error: unknown) => error === bug,
    );
  });
});

describe('projects endpoints with PostgreSQL down', () => {
  let app: NestFastifyApplication;
  let pool: pg.Pool;

  before(async () => {
    const port = await closedPort();
    pool = createPool(`postgres://portfolio:unused@127.0.0.1:${port}/portfolio`);
    app = await createTestApp({
      controllers: [ProjectsController],
      providers: [
        {
          provide: PROJECTS_REPOSITORY,
          useValue: new DrizzleProjectsRepository(createDatabase(pool)),
        },
      ],
    });
  });

  after(async () => {
    await app.close();
    await pool.end();
  });

  for (const url of ['/api/v1/projects', '/api/v1/projects/some-project']) {
    it(`GET ${url} returns a typed 503`, async () => {
      const response = await app.inject({
        method: 'GET',
        url,
        headers: { 'x-request-id': 'outage-request-1' },
      });
      assert.equal(response.statusCode, 503);
      assert.deepEqual(response.json(), {
        error: {
          code: 'not_ready',
          message: 'Service temporarily unavailable',
          requestId: 'outage-request-1',
        },
      });
    });
  }
});

describe('projects endpoints with an unexpected repository error', () => {
  let app: NestFastifyApplication;

  const failing: ProjectsRepository = {
    list: () => Promise.reject(withCode('syntax error at or near "SELEC"', '42601')),
    findBySlug: () => Promise.reject(new Error('boom')),
  };

  before(async () => {
    app = await createTestApp({
      controllers: [ProjectsController],
      providers: [{ provide: PROJECTS_REPOSITORY, useValue: failing }],
    });
  });

  after(async () => {
    await app.close();
  });

  it('still returns a generic 500 without internals', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/v1/projects' });
    assert.equal(response.statusCode, 500);
    const body = response.json<{ error: { code: string; message: string } }>();
    assert.equal(body.error.code, 'internal_error');
    assert.equal(body.error.message, 'Internal server error');
    assert.doesNotMatch(response.body, /SELEC/);
  });
});
