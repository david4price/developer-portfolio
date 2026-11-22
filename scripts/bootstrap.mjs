#!/usr/bin/env node
// pnpm bootstrap (P8-01): everything a fresh clone needs before `pnpm dev`. Checks the toolchain,
// writes `.env` from `.env.example` with a generated password (never overwriting an existing one),
// installs dependencies, starts PostgreSQL and Redis (compose.yaml) and waits until they're
// healthy, then applies migrations and seeds the registry. Safe to run again at any time.
import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  capture,
  composeVersion,
  generatePassword,
  ok,
  portInUse,
  readEnvFile,
  root,
  run,
  step,
  warn,
} from './lib/local.mjs';

const PLACEHOLDER = 'change-me-local-only';

async function main() {
  step('Checking the toolchain');
  const nodeMajor = Number(process.versions.node.split('.')[0]);
  if (nodeMajor < 24) throw new Error(`Node.js 24 or newer is required (found ${process.version})`);
  ok(`Node.js ${process.version}`);
  const compose = composeVersion();
  if (compose === undefined) throw new Error('Docker with Compose v2 is required (docker compose)');
  if (compose.major === 2 && compose.minor < 20) {
    throw new Error(
      `Docker Compose 2.20 or newer is required (found ${compose.major}.${compose.minor})`,
    );
  }
  ok(`Docker Compose ${compose.major}.${compose.minor}`);

  step('Environment (.env)');
  const envPath = join(root, '.env');
  if (existsSync(envPath)) {
    ok('.env exists; left as it is');
    if (readFileSync(envPath, 'utf8').includes(PLACEHOLDER)) {
      warn(`.env still contains "${PLACEHOLDER}"; replace it in both places it appears`);
    }
  } else {
    copyFileSync(join(root, '.env.example'), envPath);
    const password = generatePassword();
    writeFileSync(envPath, readFileSync(envPath, 'utf8').replaceAll(PLACEHOLDER, password));
    ok('.env created from .env.example with a generated database password');
  }
  const env = readEnvFile(envPath) ?? {};

  step('Dependencies');
  run('pnpm', ['install', '--frozen-lockfile']);

  step('PostgreSQL and Redis');
  // Already running from an earlier bootstrap: its ports are ours, not a conflict.
  const running = (
    capture('docker', ['compose', 'ps', '--services', '--status', 'running']) ?? ''
  ).split('\n');
  for (const [name, port] of [
    ['POSTGRES_PORT', env.POSTGRES_PORT ?? '5432'],
    ['REDIS_PORT', env.REDIS_PORT ?? '6379'],
  ]) {
    const service = name === 'POSTGRES_PORT' ? 'postgres' : 'redis';
    if (!running.includes(service) && (await portInUse(Number(port)))) {
      throw new Error(`Port ${port} is already in use; set another ${name} in .env and run again`);
    }
  }
  run('docker', ['compose', 'up', '--detach', '--wait']);
  ok('running and healthy');

  step('Database');
  run('pnpm', ['db:migrate']);
  run('pnpm', ['db:seed']);

  console.log(`
Ready. Start everything with:

  pnpm dev     # API http://127.0.0.1:${env.API_PORT ?? '3001'}/api/v1/health, site http://localhost:3000

The site's port is 3000 (PORT=3100 pnpm dev to change it; add the origin to CORS_ORIGINS).
Stop PostgreSQL and Redis with \`docker compose down\`; \`pnpm db:reset\` wipes and rebuilds them.`);
}

main().catch((error) => {
  console.error(`\n✗ ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
