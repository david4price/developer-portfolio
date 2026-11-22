// Helpers shared by the local-development scripts (P8-01). Plain Node.js, no dependencies.
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { createConnection } from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

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

/** `KEY=value` pairs of a dotenv file (comments and blank lines skipped, no interpolation). */
export function parseEnv(text) {
  const values = {};
  for (const line of text.split('\n')) {
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line);
    if (match) values[match[1]] = match[2].trim();
  }
  return values;
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

export const step = (message) => console.log(`\n▸ ${message}`);
export const ok = (message) => console.log(`  ✓ ${message}`);
export const warn = (message) => console.log(`  ! ${message}`);
