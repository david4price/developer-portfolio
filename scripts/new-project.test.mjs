// Unit tests for the project generator's helpers (P8-02). Run: node --test scripts/new-project.test.mjs
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseEnv } from './lib/local.mjs';
import { insertAbove, names, plan, schemaProblems, slugProblem } from './new-project.mjs';

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
      ['redis', /RedisModule is already used/],
      ['app', /AppModule is already used/],
      ['database', /DatabaseModule is already used/],
      ['loader', /own loader file/],
      ['error', /JavaScript global/],
      ['map', /JavaScript global/],
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

  it('keeps a title that closes a comment from breaking the generated code', () => {
    const answers = {
      slug: 'io-kit',
      title: 'I/O */ toolkit',
      summary: 'One sentence.',
      description: 'One sentence.',
      technologies: ['TypeScript'],
      repositoryUrl: null,
      featured: false,
      level: 4,
    };
    for (const { path, content } of plan(answers).creates) {
      for (const comment of content.match(/\/\*[\s\S]*?\*\//g) ?? []) {
        assert.doesNotMatch(comment.slice(2, -2), /\*\//, `${path}: a comment ends early`);
      }
    }
  });

  it('lists a featured project with the featured ones, and others after them', () => {
    const base = {
      slug: 'io-kit',
      title: 'T',
      summary: 'S.',
      description: 'D',
      technologies: ['TypeScript'],
      repositoryUrl: null,
      level: 1,
    };
    const marker = (featured) =>
      plan({ ...base, featured }).edits.find(({ line }) => line === 'ioKitProject,').marker;
    assert.equal(marker(true), '// new-project: featured projects');
    assert.equal(marker(false), '// new-project: projects');
  });

  it("rejects answers the registry's schema would reject, before writing", async () => {
    const problems = await schemaProblems({
      slug: 'io-kit',
      title: 'T',
      summary: 'S.',
      description: 'D',
      technologies: ['A very long framework name with many words in it'],
      repositoryUrl: null,
      featured: false,
      level: 2,
    });
    assert.match(problems.join('\n'), /technologies\.0: .*40/);
  });

  it('reads .env values as Compose does: quotes and an export prefix', () => {
    assert.deepEqual(parseEnv('# c\nA=1\nexport B="2"\nC=\'3\'\nD="x\n'), {
      A: '1',
      B: '2',
      C: '3',
      D: '"x',
    });
  });
});
