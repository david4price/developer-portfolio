// Unit tests for the project generator's helpers (P8-02). Run: node --test scripts/new-project.test.mjs
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { insertAbove, names, plan, slugProblem } from './new-project.mjs';

describe('new-project', () => {
  it('derives every identifier from the slug', () => {
    assert.deepEqual(names('recipe-box'), {
      slug: 'recipe-box',
      pascal: 'RecipeBox',
      camel: 'recipeBox',
      constant: 'RECIPE_BOX',
      snake: 'recipe_box',
    });
  });

  it('refuses slugs that are malformed, reserved, or already taken', () => {
    for (const [slug, reason] of [
      ['Recipe', /kebab-case/],
      ['3d-viewer', /starting with a letter/],
      ['recipe--box', /kebab-case/],
      ['a'.repeat(65), /64/],
      ['projects', /already used/],
      ['developer-portfolio', /registry already has/],
      ['infrastructure-explorer', /registry already has/],
    ]) {
      assert.match(slugProblem(slug) ?? 'accepted', reason, slug);
    }
    assert.equal(slugProblem('recipe-box'), undefined);
  });

  it('inserts above a marker with its indentation, and fails on a missing one', () => {
    const text = 'const list = [\n  first,\n  // marker\n];\n';
    assert.equal(
      insertAbove(text, '// marker', 'second,'),
      'const list = [\n  first,\n  second,\n  // marker\n];\n',
    );
    assert.throws(() => insertAbove(text, '// absent', 'x'), /marker "\/\/ absent" not found/);
  });

  it('plans more as the level rises, and keeps answers out of code except as JSON strings', () => {
    const answers = {
      slug: 'recipe-box',
      title: 'Grandma\'s "best" recipes',
      summary: 'One sentence.',
      description: 'One sentence.',
      technologies: ['TypeScript'],
      repositoryUrl: null,
      featured: false,
    };
    const counts = [1, 2, 3, 4].map((level) => plan({ ...answers, level }).creates.length);
    assert.deepEqual(counts, [1, 4, 10, 11]);
    const project = plan({ ...answers, level: 1 }).creates[0];
    assert.match(project.content, /title: "Grandma's \\"best\\" recipes",/);
    assert.match(project.content, /miniAppSlug: null,/);
    assert.equal(
      plan({
        ...answers,
        level: 1,
        repositoryUrl: 'https://example.com/r',
      }).creates[0].content.includes("kind: 'external-repository'"),
      true,
    );
    for (const { content } of plan({ ...answers, level: 4 }).creates) {
      assert.doesNotMatch(content, /__[A-Za-z]+__/, 'no placeholder left unfilled');
    }
  });
});
