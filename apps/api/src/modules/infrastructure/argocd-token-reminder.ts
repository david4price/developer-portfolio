import { Logger, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import { z } from 'zod';

/** How early the API starts reminding that the Argo CD explorer token is about to expire. */
export const TOKEN_EXPIRY_WARNING_MS = 14 * 24 * 60 * 60_000;
/** How often the token is checked, independent of anyone opening the explorer. */
export const TOKEN_CHECK_INTERVAL_MS = 60 * 60_000;
const DAY_MS = 24 * 60 * 60_000;

const jwtClaimsSchema = z.object({ exp: z.number().finite().positive() });

/**
 * When a JWT expires (its `exp` claim, as epoch ms), read without verifying: Argo CD verifies
 * the token, this only schedules a reminder. `null` for a token that isn't a JWT or has no
 * expiry. Nothing else from the token is read.
 */
export function tokenExpiresAt(token: string): number | null {
  const parts = token.trim().split('.');
  if (parts.length !== 3 || parts[1] === undefined) return null;
  try {
    const claims = jwtClaimsSchema.safeParse(
      JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')),
    );
    if (!claims.success) return null;
    const expiresAt = claims.data.exp * 1_000;
    // Out of Date's range is not an expiry anyone can act on.
    return Number.isFinite(new Date(expiresAt).getTime()) ? expiresAt : null;
  } catch {
    return null;
  }
}

/** The subset of an ioredis client the reminder uses to log once a day across replicas. */
export interface ReminderStore {
  set(key: string, value: string, ex: 'EX', seconds: number, nx: 'NX'): Promise<unknown>;
}

export interface ReminderLogger {
  warn(entry: object): void;
  error(entry: object): void;
}

export interface TokenReminderOptions {
  readonly readToken: () => Promise<string>;
  readonly store: ReminderStore;
  readonly logger?: ReminderLogger;
  readonly now?: () => number;
  readonly intervalMs?: number;
}

/**
 * Reminds operators to rotate the Argo CD explorer token (P6-05): from `TOKEN_EXPIRY_WARNING_MS`
 * before its expiry a warning, after it an error. It checks on startup and every hour, whether
 * or not anyone opens the explorer, and claims a Redis key per token expiry, level, and UTC day,
 * so the line appears once a day across replicas and restarts; a rotated token or a move from
 * warning to error logs at once. If Redis can't be asked it logs anyway: a duplicate beats
 * silence. Only the expiry date and days left are logged, never the token.
 */
export class ArgoCdTokenReminder implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger: ReminderLogger;
  private readonly now: () => number;
  private timer: NodeJS.Timeout | undefined;

  constructor(private readonly options: TokenReminderOptions) {
    this.logger = options.logger ?? new Logger('ArgoCdTokenReminder');
    this.now = options.now ?? Date.now;
  }

  onApplicationBootstrap(): void {
    void this.check();
    this.timer = setInterval(
      () => void this.check(),
      this.options.intervalMs ?? TOKEN_CHECK_INTERVAL_MS,
    );
    this.timer.unref();
  }

  onApplicationShutdown(): void {
    clearInterval(this.timer);
  }

  /** One check; never throws. Resolves once any reminder has been logged. */
  async check(): Promise<void> {
    let expiresAt: number | null;
    try {
      expiresAt = tokenExpiresAt(await this.options.readToken());
    } catch {
      // The reader reports unreadable credentials on its own refreshes.
      return;
    }
    const now = this.now();
    if (expiresAt === null || expiresAt - now > TOKEN_EXPIRY_WARNING_MS) return;
    const expired = expiresAt <= now;
    const day = new Date(now).toISOString().slice(0, 10);
    const key = `portfolio:infrastructure:argocd-token-reminder:${expiresAt}:${expired ? 'expired' : 'soon'}:${day}`;
    try {
      const claimed = await this.options.store.set(key, '1', 'EX', (2 * DAY_MS) / 1_000, 'NX');
      if (claimed === null) return;
    } catch {
      // Logging anyway: a duplicate line beats a silent expiry.
    }
    const entry = {
      expiresAt: new Date(expiresAt).toISOString(),
      daysLeft: Math.max(0, Math.ceil((expiresAt - now) / DAY_MS)),
      runbook: 'docs/deployment/kubernetes.md#argo-cd-explorer-token-p6-03',
    };
    try {
      if (expired) {
        this.logger.error({ message: 'Argo CD explorer token has expired; rotate it', ...entry });
      } else {
        this.logger.warn({ message: 'Argo CD explorer token expires soon; rotate it', ...entry });
      }
    } catch {
      // A failing log transport must not crash the interval.
    }
  }
}
