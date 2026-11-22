#!/usr/bin/env node
// pnpm new:project (P8-02): scaffolds a project from the templates in scripts/templates/project,
// asking a few questions. Depending on the answer it creates, inside the existing apps (never a
// new service):
//   1. a project page: the registry entry;
//   2. + a mini-app: its registry entry and a lazily loaded view on /apps/<slug>;
//   3. + an API module: GET /api/v1/<slug>/items behind a port, with a test;
//   4. + a database table: the module owns it, and a migration is generated.
// Everything is checked before anything is written, so a refused answer changes nothing.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { createInterface } from 'node:readline';
import { pathToFileURL } from 'node:url';
import { root, run, step } from './lib/local.mjs';

const templates = join(root, 'scripts', 'templates', 'project');
/** First paths of the API's existing routes and of pages a slug mustn't shadow. */
const RESERVED = new Set(['chat', 'health', 'infrastructure', 'projects', 'apps', 'about']);
const LEVELS = [
  'Project page only (e.g. something hosted elsewhere)',
  'Mini-app: a project page plus an interactive app on /apps/<slug>',
  'Mini-app + API module (GET /api/v1/<slug>/items)',
  'Mini-app + API module + database table (with a migration)',
];

export const names = (slug) => {
  const words = slug.split('-');
  const pascal = words.map((word) => word[0].toUpperCase() + word.slice(1)).join('');
  return {
    slug,
    pascal,
    camel: pascal[0].toLowerCase() + pascal.slice(1),
    constant: words.join('_').toUpperCase(),
    snake: words.join('_'),
  };
};

/** Refuses a slug that isn't a fresh, valid kebab-case identifier; returns the reason. */
export function slugProblem(slug) {
  if (!/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(slug)) {
    return 'use kebab-case starting with a letter, e.g. recipe-box';
  }
  if (slug.length > 64) return 'at most 64 characters';
  if (RESERVED.has(slug)) return `"${slug}" is already used by the site or the API`;
  const registryDir = join(root, 'packages', 'project-registry', 'src');
  for (const folder of ['projects', 'mini-apps']) {
    for (const file of readdirSync(join(registryDir, folder))) {
      if (readFileSync(join(registryDir, folder, file), 'utf8').includes(`slug: '${slug}'`)) {
        return `the registry already has "${slug}" (${folder}/${file})`;
      }
    }
  }
  for (const path of [
    ['apps', 'web', 'src', 'mini-apps', slug],
    ['apps', 'api', 'src', 'modules', slug],
  ]) {
    if (existsSync(join(root, ...path))) return `${path.join('/')} already exists`;
  }
  // The generated names must not clash with code that already exists, or the result won't build.
  const { pascal, camel } = names(slug);
  if (slug === 'loader') return '"loader" would overwrite the mini-app\'s own loader file';
  if (pascal in globalThis)
    return `"${pascal}" would shadow a JavaScript global; pick another slug`;
  const taken = [
    ['apps/api/src/app.module.ts', `${pascal}Module`],
    ['apps/web/src/mini-apps/index.ts', `${pascal}Loader`],
    ['packages/project-registry/src/projects/index.ts', `${camel}Project`],
    ['packages/project-registry/src/mini-apps/index.ts', `${camel}MiniApp`],
    ['packages/shared-types/src/index.ts', `${pascal}Item`],
  ];
  for (const [file, identifier] of taken) {
    if (new RegExp(`\\b${identifier}\\b`).test(readFileSync(join(root, file), 'utf8'))) {
      return `the name ${identifier} is already used in ${file}; pick another slug`;
    }
  }
  return undefined;
}

/** The registry entries the answers describe, as the schema will see them. */
export function entries(answers) {
  const project = {
    slug: answers.slug,
    title: answers.title,
    summary: answers.summary,
    description: answers.description,
    kind:
      answers.level === 1 && answers.repositoryUrl !== null
        ? 'external-repository'
        : 'portfolio-app',
    technologies: answers.technologies,
    featured: answers.featured,
    repositoryUrl: answers.repositoryUrl,
    liveUrl: null,
    miniAppSlug: answers.level >= 2 ? answers.slug : null,
  };
  const miniApp =
    answers.level >= 2
      ? { slug: answers.slug, title: answers.title, summary: answers.summary, status: 'planned' }
      : undefined;
  return { project, miniApp };
}

/**
 * Checks the entries with the registry's own schema (lengths, URLs, prompt control markup, hidden
 * text), building the package first. Returns the problems, empty when valid.
 */
export async function schemaProblems(answers) {
  run('pnpm', ['exec', 'tsc', '-b', '--pretty', 'false', 'packages/project-registry']);
  const schema = await import(
    pathToFileURL(join(root, 'packages', 'project-registry', 'dist', 'schema.js')).href
  );
  const { project, miniApp } = entries(answers);
  const results = [schema.projectSchema.safeParse(project)];
  if (miniApp !== undefined) results.push(schema.miniAppSchema.safeParse(miniApp));
  return results.flatMap((result) =>
    result.success
      ? []
      : result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`),
  );
}

export function render(template, values) {
  const text = readFileSync(join(templates, template), 'utf8');
  return text.replace(/__([A-Za-z]+)__/g, (match, key) => {
    if (!(key in values)) throw new Error(`template ${template} uses unknown ${match}`);
    return values[key];
  });
}

/** Inserts `line` above the line containing `marker`, keeping that line's indentation. */
export function insertAbove(text, marker, line) {
  const index = text.indexOf(marker);
  if (index === -1) throw new Error(`marker "${marker}" not found`);
  const lineStart = text.lastIndexOf('\n', index) + 1;
  const indent = text.slice(lineStart, index);
  return `${text.slice(0, lineStart)}${indent}${line}\n${text.slice(lineStart)}`;
}

/** Every file to create and every marker edit, computed without touching the disk. */
export function plan(answers) {
  const n = names(answers.slug);
  const { project } = entries(answers);
  const values = {
    ...n,
    Pascal: n.pascal,
    CONST: n.constant,
    // Only ever inside comments: `*/` would end the comment early.
    title: answers.title.replaceAll('*/', '*\\/'),
    titleJson: JSON.stringify(answers.title),
    summaryJson: JSON.stringify(answers.summary),
    descriptionJson: JSON.stringify(answers.description),
    technologiesJson: JSON.stringify(answers.technologies),
    featured: String(answers.featured),
    repositoryJson: JSON.stringify(answers.repositoryUrl),
    kind: project.kind,
    miniAppJson: JSON.stringify(project.miniAppSlug),
  };
  const creates = [];
  const edits = [];
  const create = (path, template) => creates.push({ path, content: render(template, values) });
  const edit = (path, marker, line) => edits.push({ path, marker, line });

  const registry = 'packages/project-registry/src';
  create(`${registry}/projects/${n.slug}.ts`, 'registry-project.ts.tpl');
  edit(
    `${registry}/projects/index.ts`,
    '// new-project: project imports',
    `import { ${n.camel}Project } from './${n.slug}.js';`,
  );
  edit(
    `${registry}/projects/index.ts`,
    answers.featured ? '// new-project: featured projects' : '// new-project: projects',
    `${n.camel}Project,`,
  );

  if (answers.level >= 2) {
    create(`${registry}/mini-apps/${n.slug}.ts`, 'registry-mini-app.ts.tpl');
    edit(
      `${registry}/mini-apps/index.ts`,
      '// new-project: mini-app imports',
      `import { ${n.camel}MiniApp } from './${n.slug}.js';`,
    );
    edit(`${registry}/mini-apps/index.ts`, '// new-project: mini-apps', `${n.camel}MiniApp,`);
    const web = `apps/web/src/mini-apps/${n.slug}`;
    create(`${web}/loader.tsx`, 'web-loader.tsx.tpl');
    create(
      `${web}/${n.slug}.tsx`,
      answers.level >= 3 ? 'web-app-api.tsx.tpl' : 'web-app-static.tsx.tpl',
    );
    edit(
      'apps/web/src/mini-apps/index.ts',
      '// new-project: web imports',
      `import { ${n.pascal}Loader } from './${n.slug}/loader.tsx';`,
    );
    edit(
      'apps/web/src/mini-apps/index.ts',
      '// new-project: web views',
      `'${n.slug}': ${n.pascal}Loader,`,
    );
    edit('apps/web/src/mini-apps/slugs.ts', '// new-project: view slugs', `'${n.slug}',`);
  }
  if (answers.level >= 3) {
    create(`packages/shared-types/src/projects/${n.slug}.ts`, 'shared-types.ts.tpl');
    edit(
      'packages/shared-types/src/index.ts',
      '// new-project: exports',
      `export type * from './projects/${n.slug}.js';`,
    );
    const api = `apps/api/src/modules/${n.slug}`;
    create(`${api}/${n.slug}.repository.ts`, 'api-repository.ts.tpl');
    create(`${api}/${n.slug}.controller.ts`, 'api-controller.ts.tpl');
    create(`apps/api/test/${n.slug}.test.ts`, 'api-test.ts.tpl');
    if (answers.level === 4) {
      create(`${api}/${n.slug}.schema.ts`, 'api-schema.ts.tpl');
      create(`${api}/drizzle-${n.slug}.repository.ts`, 'api-drizzle-repository.ts.tpl');
      create(`${api}/${n.slug}.module.ts`, 'api-module-db.ts.tpl');
    } else {
      create(`${api}/static-${n.slug}.repository.ts`, 'api-static-repository.ts.tpl');
      create(`${api}/${n.slug}.module.ts`, 'api-module-static.ts.tpl');
    }
    edit(
      'apps/api/src/app.module.ts',
      '// new-project: module imports',
      `import { ${n.pascal}Module } from './modules/${n.slug}/${n.slug}.module.js';`,
    );
    edit('apps/api/src/app.module.ts', '// new-project: modules', `${n.pascal}Module,`);
  }
  return { creates, edits, names: n };
}

/** Applies a plan: every marker is checked first, so a missing one changes nothing. */
export function apply({ creates, edits }) {
  const edited = new Map();
  for (const { path, marker, line } of edits) {
    const current = edited.get(path) ?? readFileSync(join(root, path), 'utf8');
    edited.set(path, insertAbove(current, marker, line));
  }
  const paths = creates.map(({ path }) => path);
  const duplicate = paths.find((path, index) => paths.indexOf(path) !== index);
  if (duplicate !== undefined) throw new Error(`two files would be written to ${duplicate}`);
  for (const path of paths) {
    if (existsSync(join(root, path))) throw new Error(`${path} already exists`);
  }
  for (const { path, content } of creates) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  }
  for (const [path, content] of edited) writeFileSync(join(root, path), content);
  return [...creates.map(({ path }) => path), ...edited.keys()];
}

async function ask(prompt, question, { fallback, check } = {}) {
  for (;;) {
    const suffix = fallback === undefined || fallback === '' ? '' : ` [${fallback}]`;
    process.stdout.write(`${question}${suffix}: `);
    const next = await prompt.next();
    if (next.done) throw new Error('input ended before every question was answered');
    if (!process.stdin.isTTY) process.stdout.write(`${next.value}\n`); // echo piped answers
    const raw = next.value.trim();
    const answer = raw === '' && fallback !== undefined ? fallback : raw;
    const problem = check?.(answer);
    if (problem === undefined) return answer;
    console.log(`  ! ${problem}`);
  }
}

const within = (max) => (value) =>
  value.length === 0 ? 'required' : value.length > max ? `at most ${max} characters` : undefined;

async function main() {
  // Lines are read through the iterator, which buffers them: piped answers (CI) work like typed
  // ones, where readline/promises' question() would drop lines that arrive all at once.
  const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
  const prompt = lines[Symbol.asyncIterator]();
  try {
    console.log('New portfolio project. Answers can be edited later in the files it creates.\n');
    const slug = await ask(prompt, 'Slug (URL name, e.g. recipe-box)', { check: slugProblem });
    const title = await ask(prompt, 'Title', { check: within(80) });
    const summary = await ask(prompt, 'One-sentence summary', { check: within(200) });
    const description = await ask(prompt, 'Description (plain text)', {
      fallback: summary,
      check: within(4_000),
    });
    const technologies = (
      await ask(prompt, 'Technologies, comma-separated', {
        fallback: 'TypeScript',
        check: (value) => {
          const list = value
            .split(',')
            .map((item) => item.trim())
            .filter(Boolean);
          return list.length < 1 || list.length > 20 ? '1 to 20 names' : undefined;
        },
      })
    )
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
    console.log('\nWhat should it include?');
    LEVELS.forEach((label, index) => console.log(`  ${index + 1}. ${label}`));
    const level = Number(
      await ask(prompt, 'Choose 1-4', {
        fallback: '2',
        check: (value) => (/^[1-4]$/.test(value) ? undefined : 'enter 1, 2, 3, or 4'),
      }),
    );
    const repository = await ask(prompt, 'Repository URL (https://…, optional)', {
      fallback: '',
      check: (value) =>
        value === '' || /^https:\/\/\S+$/.test(value) ? undefined : 'an https:// URL, or empty',
    });
    const featured = /^y(es)?$/i.test(
      await ask(prompt, 'Feature it on the home page? (y/N)', { fallback: 'n' }),
    );

    const answers = {
      slug,
      title,
      summary,
      description,
      technologies,
      level,
      repositoryUrl: repository === '' ? null : repository,
      featured,
    };
    const problems = await schemaProblems(answers);
    if (problems.length > 0) {
      throw new Error(
        `The registry would reject these answers (nothing was written):\n  ${problems.join('\n  ')}`,
      );
    }
    const result = plan(answers);
    console.log(`\nThis creates:\n${result.creates.map(({ path }) => `  + ${path}`).join('\n')}`);
    console.log(
      `and registers it in:\n${[...new Set(result.edits.map(({ path }) => path))].map((path) => `  ~ ${path}`).join('\n')}`,
    );
    if (level === 4) console.log('and generates a migration in apps/api/drizzle/.');
    const go = await ask(prompt, '\nCreate it? (Y/n)', { fallback: 'y' });
    if (!/^y(es)?$/i.test(go)) {
      console.log('Nothing changed.');
      return;
    }
    lines.close();

    step('Writing files');
    const touched = apply(result);
    run('pnpm', ['exec', 'prettier', '--write', '--log-level', 'warn', ...touched]);
    if (level === 4) {
      step('Generating the migration');
      run('pnpm', [
        '--filter',
        '@portfolio/api',
        'exec',
        'drizzle-kit',
        'generate',
        '--name',
        `${result.names.snake}_init`,
      ]);
    }
    const nextSteps = [
      `\nCreated "${title}". Next:`,
      '  pnpm check          # format, lint, types, and tests, including the new ones',
      ...(level === 4 ? ['  pnpm db:migrate     # creates the new table locally'] : []),
      "  pnpm db:seed        # adds the project to the API's list (GET /api/v1/projects)",
      `  pnpm dev            # then open http://localhost:3000/projects/${slug}`,
      ...(level >= 2 ? [`                      # and http://localhost:3000/apps/${slug}`] : []),
      `\nEdit the description and links in ${relative(root, join(root, `packages/project-registry/src/projects/${slug}.ts`))}.`,
      ...(level >= 2
        ? [
            "Set the mini-app's status to 'available' once it really works (its page shows a badge until then).",
          ]
        : []),
    ];
    console.log(nextSteps.join('\n'));
  } finally {
    lines.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`\n✗ ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
