import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { registry } from '@portfolio/project-registry';
import type { ProjectDetail, ProjectListResponse } from '@portfolio/shared-types';
import { encodeProjectCursor } from '../src/modules/projects/project-page.js';
import { ProjectsController } from '../src/modules/projects/projects.controller.js';
import { PROJECTS_REPOSITORY } from '../src/modules/projects/projects.repository.js';
import {
  compareProjects,
  InMemoryProjectsRepository,
} from './support/in-memory-projects.repository.js';
import { createTestApp } from './support/test-app.js';

function syntheticProject(index: number, title: string, featured: boolean): ProjectDetail {
  return {
    slug: `project-${String(index).padStart(2, '0')}`,
    title,
    summary: `Summary ${index}`,
    description: `Description ${index}`,
    kind: 'external-repository',
    technologies: ['TypeScript'],
    featured,
    repositoryUrl: null,
    liveUrl: null,
    miniAppSlug: null,
  };
}

/** 60 projects: mixed featured flags and repeated titles, so slug tie-breaks matter. */
const manyProjects = Array.from({ length: 60 }, (_, index) =>
  syntheticProject(index, `Title ${index % 7}`, index % 4 === 0),
);

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

  it('lists registry projects as summaries on a single page', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/v1/projects' });
    assert.equal(response.statusCode, 200);

    const body = response.json<{ items: Record<string, unknown>[]; nextCursor: unknown }>();
    assert.deepEqual(
      body.items.map((item) => item.slug),
      [...registry.projects].sort(compareProjects).map((project) => project.slug),
    );
    assert.deepEqual(Object.keys(body.items[0] ?? {}).sort(), [
      'featured',
      'kind',
      'slug',
      'summary',
      'technologies',
      'title',
    ]);
    assert.equal(body.nextCursor, null);
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

describe('projects pagination', () => {
  let app: NestFastifyApplication;
  const expectedOrder = [...manyProjects].sort(compareProjects).map((project) => project.slug);

  before(async () => {
    app = await createTestApp({
      controllers: [ProjectsController],
      providers: [
        { provide: PROJECTS_REPOSITORY, useValue: new InMemoryProjectsRepository(manyProjects) },
      ],
    });
  });

  after(async () => {
    await app.close();
  });

  async function getPage(query: string): Promise<ProjectListResponse> {
    const response = await app.inject({ method: 'GET', url: `/api/v1/projects${query}` });
    assert.equal(response.statusCode, 200, response.body);
    return response.json<ProjectListResponse>();
  }

  it('defaults to 20 items with a next cursor', async () => {
    const page = await getPage('');
    assert.equal(page.items.length, 20);
    assert.equal(typeof page.nextCursor, 'string');
  });

  for (const limit of [1, 7, 50]) {
    it(`walks every project exactly once with limit=${limit}`, async () => {
      const seen: string[] = [];
      let cursor: string | null = null;
      do {
        const query: string = `?limit=${limit}${cursor === null ? '' : `&cursor=${cursor}`}`;
        const page = await getPage(query);
        assert.ok(page.items.length <= limit);
        seen.push(...page.items.map((item) => item.slug));
        cursor = page.nextCursor;
      } while (cursor !== null);
      assert.deepEqual(seen, expectedOrder);
    });
  }

  it('returns no cursor when the last page is exactly full', async () => {
    const first = await getPage('?limit=50');
    assert.ok(first.nextCursor);
    const last = await getPage(`?limit=10&cursor=${first.nextCursor}`);
    assert.equal(last.items.length, 10);
    assert.equal(last.nextCursor, null);
  });

  const badQueries = [
    '?limit=0',
    '?limit=51',
    '?limit=abc',
    '?limit=2.5',
    '?limit=1&limit=2',
    '?cursor=',
    '?cursor=not%20base64!',
    `?cursor=${Buffer.from('not json').toString('base64url')}`,
    `?cursor=${Buffer.from('{"f":true,"t":"x"}').toString('base64url')}`,
    `?cursor=${Buffer.from('{"f":true,"t":"x","s":"Bad_Slug"}').toString('base64url')}`,
    `?cursor=${Buffer.from('{"f":true,"t":"x","s":"ok","extra":1}').toString('base64url')}`,
    `?cursor=${'a'.repeat(513)}`,
  ];

  for (const query of badQueries) {
    it(`rejects ${query.slice(0, 40)} with a typed 400`, async () => {
      const response = await app.inject({ method: 'GET', url: `/api/v1/projects${query}` });
      assert.equal(response.statusCode, 400, response.body);
      assert.equal(response.json<{ error: { code: string } }>().error.code, 'bad_request');
    });
  }

  it('accepts a cursor it issued for a position that no longer exists', async () => {
    const cursor = encodeProjectCursor({ featured: true, title: 'Title 3', slug: 'gone' });
    const page = await getPage(`?limit=50&cursor=${cursor}`);
    assert.ok(
      page.items.every(
        (item) =>
          compareProjects(item, {
            featured: true,
            title: 'Title 3',
            slug: 'gone',
          }) > 0,
      ),
    );
  });
});
