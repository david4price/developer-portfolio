import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  createRegistry,
  findProject,
  miniAppRouteParams,
  projectRouteParams,
  registry,
  type RegistryInput,
} from '../src/index.js';

const validProject: RegistryInput['projects'][number] = {
  slug: 'example',
  title: 'Example',
  summary: 'Example project',
  description: 'Example description',
  kind: 'portfolio-app',
  technologies: ['TypeScript'],
  featured: false,
  repositoryUrl: null,
  liveUrl: null,
  miniAppSlug: null,
};

describe('shipped registry', () => {
  it('is valid and non-empty', () => {
    assert.ok(registry.projects.length > 0);
  });

  it('produces one static route per project and mini-app', () => {
    assert.deepEqual(
      projectRouteParams().map(({ slug }) => slug),
      registry.projects.map(({ slug }) => slug),
    );
    assert.deepEqual(
      miniAppRouteParams().map(({ slug }) => slug),
      registry.miniApps.map(({ slug }) => slug),
    );
  });

  it('finds projects by slug only', () => {
    const first = registry.projects[0];
    assert.ok(first);
    assert.equal(findProject(first.slug)?.slug, first.slug);
    assert.equal(findProject('does-not-exist'), undefined);
  });
});

describe('createRegistry', () => {
  it('rejects duplicate slugs', () => {
    assert.throws(
      () => createRegistry({ projects: [validProject, validProject], miniApps: [] }),
      /duplicate project slug: example/,
    );
  });

  it('rejects references to unknown mini-apps', () => {
    assert.throws(
      () =>
        createRegistry({ projects: [{ ...validProject, miniAppSlug: 'missing' }], miniApps: [] }),
      /unknown mini-app missing/,
    );
  });

  it('rejects non-https links and non-kebab-case slugs', () => {
    assert.throws(() =>
      createRegistry({
        projects: [{ ...validProject, repositoryUrl: 'http://example.com' }],
        miniApps: [],
      }),
    );
    assert.throws(() =>
      createRegistry({ projects: [{ ...validProject, slug: 'Not_Valid' }], miniApps: [] }),
    );
  });

  it('requires a repository link for external projects', () => {
    assert.throws(
      () =>
        createRegistry({
          projects: [{ ...validProject, kind: 'external-repository' }],
          miniApps: [],
        }),
      /must link its repository/,
    );
  });
});
