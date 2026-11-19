import { readFile } from 'node:fs/promises';
import { request as httpRequest, type IncomingMessage } from 'node:http';
import { Agent, request as httpsRequest } from 'node:https';
import { Logger } from '@nestjs/common';
import { z } from 'zod';
import { declaredTooLarge, readJsonStream } from '../../common/read-json-body.js';
import {
  DeploymentReadError,
  type DeploymentReader,
  type DeploymentStatus,
} from './deployment-reader.js';

const revision = z.string().regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/);
const historyEntry = z.object({
  id: z.number().int().nonnegative(),
  revision: revision.optional(),
  revisions: z.array(revision).min(1).optional(),
  deployedAt: z.iso.datetime({ offset: true }),
});
const applicationSchema = z.object({
  metadata: z.object({ name: z.string() }),
  spec: z.object({ project: z.string() }),
  status: z.object({
    sync: z.object({ status: z.string() }).optional(),
    // Entries are checked separately: malformed history cannot hide current sync status.
    history: z.array(z.unknown()).optional(),
  }),
});

/** Argo CD objects contain repository URLs, rendered values, and internal addresses. Drop them. */
export function serializeDeploymentStatus(
  value: unknown,
  application: string,
  project: string,
): DeploymentStatus {
  const parsed = applicationSchema.safeParse(value);
  if (
    !parsed.success ||
    parsed.data.metadata.name !== application ||
    parsed.data.spec.project !== project
  ) {
    throw new DeploymentReadError('invalid_response');
  }
  const status = parsed.data.status;
  const history = (status.history ?? [])
    .flatMap((entry) => {
      const item = historyEntry.safeParse(entry);
      return item.success ? [item.data] : [];
    })
    .sort((a, b) => b.id - a.id);
  const latest = history[0];
  // The first source is the chart; the reference multi-source Application pins all sources to
  // the same repository revision. Never call the comparison target a successfully deployed release.
  const commit = latest?.revisions?.[0] ?? latest?.revision;
  return {
    sync:
      status.sync?.status === 'Synced'
        ? 'synced'
        : status.sync?.status === 'OutOfSync'
          ? 'out-of-sync'
          : 'unknown',
    release:
      latest === undefined || commit === undefined
        ? null
        : {
            commit: commit.slice(0, 7),
            pinnedAt: new Date(latest.deployedAt).toISOString(),
          },
  };
}

/** How early the API starts warning that the Argo CD token is about to expire. */
export const TOKEN_EXPIRY_WARNING_MS = 14 * 24 * 60 * 60_000;
const DAY_MS = 24 * 60 * 60_000;

const jwtClaimsSchema = z.object({ exp: z.number().finite().positive() });

/**
 * When a JWT expires (its `exp` claim, as epoch ms), read without verifying: Argo CD verifies
 * the token, this only schedules a reminder. `null` for a token that isn't a JWT or has no
 * expiry. Nothing else from the token is read.
 */
export function tokenExpiresAt(token: string): number | null {
  const parts = token.split('.');
  if (parts.length !== 3 || parts[1] === undefined) return null;
  try {
    const claims = jwtClaimsSchema.safeParse(
      JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')),
    );
    return claims.success ? claims.data.exp * 1_000 : null;
  } catch {
    return null;
  }
}

export interface ArgoCdReaderOptions {
  readonly serverUrl: string;
  readonly application: string;
  readonly project: string;
  readonly tokenFile: string;
  readonly caFile: string;
  readonly readFile?: (path: string) => Promise<string>;
  readonly maxResponseBytes?: number;
  readonly allowInsecureHttpForTests?: boolean;
  readonly now?: () => number;
}

/** One fixed GET, no redirects; token and CA reread so projected Secret rotation takes effect. */
export class ArgoCdApplicationReader implements DeploymentReader {
  private readonly url: URL;
  private readonly readFile: (path: string) => Promise<string>;
  private pool: { readonly ca: string; readonly agent: Agent } | null = null;
  private readonly logger = new Logger('ArgoCdApplicationReader');
  private readonly now: () => number;
  /** When the expiry reminder last went out, so it repeats daily rather than every refresh. */
  private expiryWarnedAt: number | null = null;

  constructor(private readonly options: ArgoCdReaderOptions) {
    const base = new URL(options.serverUrl);
    if (
      (base.protocol !== 'https:' &&
        !(options.allowInsecureHttpForTests && base.protocol === 'http:')) ||
      base.username ||
      base.password ||
      base.pathname !== '/' ||
      base.search ||
      base.hash
    ) {
      throw new Error('The Argo CD server URL must be an HTTPS origin');
    }
    this.url = new URL(`/api/v1/applications/${encodeURIComponent(options.application)}`, base);
    this.url.searchParams.set('project', options.project);
    this.readFile = options.readFile ?? ((path) => readFile(path, 'utf8'));
    this.now = options.now ?? Date.now;
  }

  /**
   * A reminder to rotate: a warning once a day from `TOKEN_EXPIRY_WARNING_MS` before the token's
   * expiry, an error once a day after it. Only the expiry date and days left are logged.
   */
  private remindBeforeExpiry(token: string): void {
    const expiresAt = tokenExpiresAt(token);
    const now = this.now();
    if (expiresAt === null || expiresAt - now > TOKEN_EXPIRY_WARNING_MS) {
      this.expiryWarnedAt = null;
      return;
    }
    if (this.expiryWarnedAt !== null && now - this.expiryWarnedAt < DAY_MS) return;
    this.expiryWarnedAt = now;
    const entry = {
      expiresAt: new Date(expiresAt).toISOString(),
      daysLeft: Math.max(0, Math.floor((expiresAt - now) / DAY_MS)),
      runbook: 'docs/deployment/kubernetes.md#argo-cd-explorer-token-p6-03',
    };
    if (expiresAt <= now) {
      this.logger.error({ message: 'Argo CD explorer token has expired; rotate it', ...entry });
    } else {
      this.logger.warn({ message: 'Argo CD explorer token expires soon; rotate it', ...entry });
    }
  }

  async read(signal: AbortSignal): Promise<DeploymentStatus> {
    let token: string;
    let agent: Agent | undefined;
    try {
      token = (await this.readFile(this.options.tokenFile)).trim();
      if (!token || /\s/.test(token)) throw new Error('Invalid credential');
      this.remindBeforeExpiry(token);
      if (this.url.protocol === 'https:') {
        const ca = await this.readFile(this.options.caFile);
        if (this.pool?.ca !== ca) {
          this.pool?.agent.destroy();
          this.pool = { ca, agent: new Agent({ ca, keepAlive: true }) };
        }
        agent = this.pool.agent;
      }
    } catch {
      throw new DeploymentReadError('credentials');
    }
    let response: IncomingMessage | undefined;
    try {
      response = await new Promise<IncomingMessage>((resolve, reject) => {
        const send = this.url.protocol === 'https:' ? httpsRequest : httpRequest;
        const request = send(
          this.url,
          {
            method: 'GET',
            signal,
            ...(agent === undefined ? {} : { agent }),
            headers: { authorization: `Bearer ${token}`, accept: 'application/json' },
          },
          resolve,
        );
        request.on('error', reject);
        request.end();
      });
      if (response.statusCode !== 200)
        throw new DeploymentReadError('status', response.statusCode ?? null);
      const max = this.options.maxResponseBytes ?? 512 * 1024;
      const body = declaredTooLarge(response.headers['content-length'], max)
        ? undefined
        : await readJsonStream(response, max);
      return serializeDeploymentStatus(body, this.options.application, this.options.project);
    } catch (error) {
      if (error instanceof DeploymentReadError) throw error;
      throw new DeploymentReadError(signal.aborted ? 'timeout' : 'network');
    } finally {
      if (response !== undefined && !response.complete) response.destroy();
    }
  }
}
