import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import { Global, Module } from '@nestjs/common';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { HealthModule } from '../src/modules/health/health.module.js';
import { evaluateReadiness, type ReadinessCheck } from '../src/modules/health/readiness.js';
import { createTestApp } from './support/test-app.js';

const DATABASE_CHECK = Symbol('DATABASE_CHECK');
const CACHE_CHECK = Symbol('CACHE_CHECK');

function checksModule(database: ReadinessCheck, cache: ReadinessCheck) {
  @Global()
  @Module({
    providers: [
      { provide: DATABASE_CHECK, useValue: database },
      { provide: CACHE_CHECK, useValue: cache },
    ],
    exports: [DATABASE_CHECK, CACHE_CHECK],
  })
  class ChecksModule {}
  return ChecksModule;
}

const up = (name: string): ReadinessCheck => ({ name, check: () => Promise.resolve() });
const down = (name: string): ReadinessCheck => ({
  name,
  check: () => Promise.reject(new Error('connection refused')),
});

async function appWith(database: ReadinessCheck, cache: ReadinessCheck) {
  return createTestApp({
    imports: [checksModule(database, cache), HealthModule.forChecks([DATABASE_CHECK, CACHE_CHECK])],
  });
}

describe('health endpoints', () => {
  const apps: NestFastifyApplication[] = [];
  after(async () => {
    await Promise.all(apps.map((app) => app.close()));
  });

  it('reports liveness without consulting dependencies', async () => {
    const app = await appWith(down('postgres'), down('redis'));
    apps.push(app);

    const response = await app.inject({ method: 'GET', url: '/api/v1/health' });
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json(), { status: 'ok' });
  });

  it('reports ready when every dependency is up', async () => {
    const app = await appWith(up('postgres'), up('redis'));
    apps.push(app);

    const response = await app.inject({ method: 'GET', url: '/api/v1/health/ready' });
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json(), {
      status: 'ready',
      checks: { postgres: 'up', redis: 'up' },
    });
  });

  it('returns 503 and names the failed dependency', async () => {
    const app = await appWith(up('postgres'), down('redis'));
    apps.push(app);

    const response = await app.inject({ method: 'GET', url: '/api/v1/health/ready' });
    assert.equal(response.statusCode, 503);
    assert.deepEqual(response.json(), {
      status: 'not_ready',
      checks: { postgres: 'up', redis: 'down' },
    });
  });
});

describe('evaluateReadiness', () => {
  it('treats a hanging check as down after the timeout', async () => {
    const hanging: ReadinessCheck = { name: 'slow', check: () => new Promise(() => undefined) };
    const result = await evaluateReadiness([hanging, up('fast')], 20);
    assert.deepEqual(result, { status: 'not_ready', checks: { slow: 'down', fast: 'up' } });
  });
});
