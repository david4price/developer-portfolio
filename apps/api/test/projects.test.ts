import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { registry } from '@portfolio/project-registry';
import type { ProjectDetail } from '@portfolio/shared-types';
import { ProjectsController } from '../src/modules/projects/projects.controller.js';
import {
  PROJECTS_REPOSITORY,
  type ProjectsRepository,
} from '../src/modules/projects/projects.repository.js';
import { createTestApp } from './support/test-app.js';

class InMemoryProjectsRepository implements ProjectsRepository {
  constructor(private readonly projects: readonly ProjectDetail[]) {}

  async list() {
    return this.projects;
  }

  async findBySlug(slug: string) {
    return this.projects.find((project) => project.slug === slug);
  }
}

describe('projects endpoints', () => {
  let app: NestFastifyApplication;

  before(async () => {
    app = await createTestApp(
      {
        controllers: [ProjectsController],
        providers: [
          {
            provide: PROJECTS_REPOSITORY,
            useValue: new InMemoryProjectsRepository(registry.projects),
          },
        ],
      },
      ['https://portfolio.example.com'],
    );
  });

  after(async () => {
    await app.close();
  });

  it('lists registry projects as summaries', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/v1/projects' });
    assert.equal(response.statusCode, 200);

    const body = response.json<{ items: Record<string, unknown>[] }>();
    assert.deepEqual(
      body.items.map((item) => item.slug),
      registry.projects.map((project) => project.slug),
    );
    assert.equal(body.items[0]?.description, undefined, 'summaries omit long descriptions');
  });

  it('returns project details by slug', async () => {
    const project = registry.projects[0];
    assert.ok(project);

    const response = await app.inject({ method: 'GET', url: `/api/v1/projects/${project.slug}` });
    assert.equal(response.statusCode, 200);
    assert.equal(response.json<ProjectDetail>().description, project.description);
  });

  it('returns a typed 404 with the request id', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/projects/unknown-project',
      headers: { 'x-request-id': 'test-request-1' },
    });
    assert.equal(response.statusCode, 404);
    assert.deepEqual(response.json(), {
      error: { code: 'not_found', message: 'Project not found', requestId: 'test-request-1' },
    });
    assert.equal(response.headers['x-request-id'], 'test-request-1');
  });

  it('rejects malformed slugs with a 400', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/v1/projects/Not_A_Slug' });
    assert.equal(response.statusCode, 400);
    assert.equal(response.json<{ error: { code: string } }>().error.code, 'bad_request');
  });

  it('replaces malformed incoming request ids', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/projects',
      headers: { 'x-request-id': 'bad id with spaces' },
    });
    const requestId = response.headers['x-request-id'];
    assert.equal(typeof requestId, 'string');
    assert.notEqual(requestId, 'bad id with spaces');
  });

  it('sets defensive response headers', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/v1/projects' });
    assert.equal(response.headers['x-content-type-options'], 'nosniff');
    assert.equal(response.headers['cache-control'], 'no-store');
  });

  it('allows only configured CORS origins', async () => {
    const allowed = await app.inject({
      method: 'GET',
      url: '/api/v1/projects',
      headers: { origin: 'https://portfolio.example.com' },
    });
    assert.equal(allowed.headers['access-control-allow-origin'], 'https://portfolio.example.com');

    const denied = await app.inject({
      method: 'GET',
      url: '/api/v1/projects',
      headers: { origin: 'https://attacker.example.net' },
    });
    assert.equal(denied.headers['access-control-allow-origin'], undefined);
  });

  it('renders unknown routes as typed 404s', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/v1/admin' });
    assert.equal(response.statusCode, 404);
    assert.equal(response.json<{ error: { code: string } }>().error.code, 'not_found');
  });
});
