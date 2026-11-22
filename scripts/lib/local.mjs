// Helpers shared by the local-development scripts (P8-01). Plain Node.js, no dependencies.
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { createConnection } from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath, URL } from 'node:url';

export const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Runs a command in the repository root, streaming its output; throws when it fails. */
export function run(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit', ...options });
  if (result.error) throw new Error(`${command} could not start: ${result.error.message}`);
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} exited with ${result.status ?? result.signal}`);
  }
}

/** Runs a command and returns its trimmed standard output, or `undefined` when it fails. */
export function capture(command, args) {
  const result = spawnSync(command, args, { cwd: root, encoding: 'utf8' });
  return result.status === 0 ? result.stdout.trim() : undefined;
}

/**
 * `KEY=value` pairs of a dotenv file, read as Compose and Node's --env-file do: comments and blank
 * lines skipped, an `export ` prefix allowed, one pair of surrounding quotes removed.
 */
export function parseEnv(text) {
  const values = {};
  for (const line of text.split('\n')) {
    const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line);
    if (!match) continue;
    const value = match[2].trim();
    // A quoted value ends at its closing quote; an unquoted one at ` #` (an inline comment).
    const quoted = /^(['"])(.*?)\1(?:\s+#.*)?$/.exec(value);
    values[match[1]] = quoted ? quoted[2] : value.replace(/\s+#.*$/, '');
  }
  return values;
}

/**
 * Where DATABASE_URL and REDIS_URL (what the apps connect to) disagree with the ports Compose
 * publishes, as messages. An empty or missing port means Compose's default, as `${X:-default}`.
 */
export function portMismatches(env) {
  const problems = [];
  for (const [url, portKey, fallback] of [
    ['DATABASE_URL', 'POSTGRES_PORT', '5432'],
    ['REDIS_URL', 'REDIS_PORT', '6379'],
  ]) {
    if (!env[url]) {
      problems.push(`${url} is missing from .env (copy it from .env.example)`);
      continue;
    }
    let target;
    try {
      target = new URL(env[url]);
    } catch {
      problems.push(`${url} in .env is not a valid URL`);
      continue;
    }
    const published = env[portKey] || fallback;
    const used = target.port || fallback;
    if (['localhost', '127.0.0.1'].includes(target.hostname) && used !== published) {
      problems.push(`${url} uses port ${used} but ${portKey} is ${published}; make them the same`);
    }
  }
  return problems;
}

/** Services of the project other than PostgreSQL and Redis, from `docker ps` labels. */
export function otherServices(labels) {
  const others = labels
    .split('\n')
    .map((service) => service.trim())
    .filter((service) => service !== '' && service !== 'postgres' && service !== 'redis');
  return [...new Set(others)];
}

export function readEnvFile(path = join(root, '.env')) {
  return existsSync(path) ? parseEnv(readFileSync(path, 'utf8')) : undefined;
}

/** A URL-safe password: letters and digits only, as `.env.example` asks (it sits in a URL). */
export function generatePassword() {
  return randomBytes(24).toString('base64url').replace(/[-_]/g, 'x');
}

/** Resolves true when something accepts TCP connections on 127.0.0.1:<port>. */
export function portInUse(port) {
  return new Promise((resolve) => {
    const socket = createConnection({ host: '127.0.0.1', port });
    socket.setTimeout(500);
    socket.once('connect', () => (socket.destroy(), resolve(true)));
    socket.once('timeout', () => (socket.destroy(), resolve(false)));
    socket.once('error', () => resolve(false));
  });
}

/** `major.minor` of `docker compose version`, or undefined without Docker Compose v2. */
export function composeVersion() {
  const output = capture('docker', ['compose', 'version', '--short']);
  const match = output === undefined ? null : /^v?(\d+)\.(\d+)/.exec(output);
  return match ? { major: Number(match[1]), minor: Number(match[2]) } : undefined;
}

/** Compose's normalization of a project name: lowercase, only [a-z0-9_-], starting alphanumeric. */
export const normalizeProject = (name) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '')
    .replace(/^[^a-z0-9]+/, '');

/**
 * The Compose project name as Compose resolves it (the shell's or `.env`'s COMPOSE_PROJECT_NAME,
 * else compose.yaml's `name:`), asked from Compose itself. Without a `.env` yet, the example
 * supplies the variables compose.yaml requires.
 */
export function composeProject() {
  const envFile = existsSync(join(root, '.env')) ? '.env' : '.env.example';
  const config = capture('docker', [
    'compose',
    '--env-file',
    envFile,
    'config',
    '--format',
    'json',
  ]);
  if (config !== undefined) {
    const { name } = JSON.parse(config);
    if (typeof name === 'string' && name !== '') return name;
  }
  return normalizeProject(process.env.COMPOSE_PROJECT_NAME || 'developer-portfolio');
}

export const step = (message) => console.log(`\n▸ ${message}`);
export const ok = (message) => console.log(`  ✓ ${message}`);
export const warn = (message) => console.log(`  ! ${message}`);
