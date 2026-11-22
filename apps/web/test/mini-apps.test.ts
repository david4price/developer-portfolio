import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { registry } from '@portfolio/project-registry';
import { miniAppViewSlugs } from '../src/mini-apps/slugs.ts';

describe('mini-app views', () => {
  it('has a view for every available mini-app, and none for apps the registry lacks', () => {
    const registered = new Set(registry.miniApps.map((app) => app.slug));
    for (const app of registry.miniApps.filter(({ status }) => status === 'available')) {
      assert.ok(
        (miniAppViewSlugs as readonly string[]).includes(app.slug),
        `no view for available mini-app ${app.slug}`,
      );
    }
    for (const slug of miniAppViewSlugs) {
      assert.ok(registered.has(slug), `view for ${slug}, which the registry doesn't list`);
    }
  });
});
