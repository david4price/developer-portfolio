#!/usr/bin/env node
// pnpm db:reset (P8-01): deletes the local PostgreSQL and Redis data (this repository's
// compose.yaml volumes only), starts them again empty, then migrates and seeds. Asks first;
// `--yes` skips the question for scripts.
import { createInterface } from 'node:readline/promises';
import { capture, ok, run, step } from './lib/local.mjs';

async function confirmed() {
  if (process.argv.includes('--yes')) return true;
  if (!process.stdin.isTTY) {
    throw new Error('Refusing to wipe the database without a terminal; pass --yes to confirm');
  }
  const project = capture('docker', ['compose', 'config', '--format', 'json']);
  const name = project === undefined ? 'this project' : JSON.parse(project).name;
  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await prompt.question(
      `This deletes all local PostgreSQL and Redis data of "${name}" (its Docker volumes).\n` +
        'Type "reset" to continue: ',
    );
    return answer.trim() === 'reset';
  } finally {
    prompt.close();
  }
}

async function main() {
  if (!(await confirmed())) {
    console.log('Nothing changed.');
    return;
  }
  step('Removing PostgreSQL and Redis with their data');
  run('docker', ['compose', 'down', '--volumes']);
  step('Starting them again');
  run('docker', ['compose', 'up', '--detach', '--wait']);
  ok('running and healthy');
  step('Database');
  run('pnpm', ['db:migrate']);
  run('pnpm', ['db:seed']);
  console.log('\nReset done: an empty database with the registry seeded.');
}

main().catch((error) => {
  console.error(`\n✗ ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
