import type { Redis } from 'ioredis';
import { z } from 'zod';
import { DependencyUnavailableError } from '../../common/dependency-unavailable.error.js';
import type { ChatSession, ChatSessionStore } from './chat-session.store.js';

/** Namespaced so portfolio chat can never collide with any other data in the same Redis. */
const SESSION_PREFIX = 'portfolio:chat:session:';
const LOCK_PREFIX = 'portfolio:chat:lock:';

/** Deletes the lock only if it still holds this request's token. */
const RELEASE_LOCK = `if redis.call('get', KEYS[1]) == ARGV[1] then
  return redis.call('del', KEYS[1])
end
return 0`;

const sessionSchema = z.object({
  expiresAt: z.iso.datetime(),
  history: z.array(
    z.object({ role: z.enum(['user', 'assistant']), content: z.string().max(10_000) }),
  ),
});

async function withRedis<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    throw new DependencyUnavailableError('redis', { cause: error });
  }
}

export class RedisChatSessionStore implements ChatSessionStore {
  constructor(private readonly redis: Redis) {}

  async create(sessionId: string, ttlSeconds: number): Promise<ChatSession> {
    const session: ChatSession = {
      expiresAt: new Date(Date.now() + ttlSeconds * 1_000).toISOString(),
      history: [],
    };
    // NX: a 256-bit random ID never collides; refusing to overwrite makes that an invariant.
    const created = await withRedis(() =>
      this.redis.set(SESSION_PREFIX + sessionId, JSON.stringify(session), 'EX', ttlSeconds, 'NX'),
    );
    if (created !== 'OK') throw new Error('chat session ID collision');
    return session;
  }

  async load(sessionId: string): Promise<ChatSession | undefined> {
    const raw = await withRedis(() => this.redis.get(SESSION_PREFIX + sessionId));
    if (raw === null) return undefined;
    // Corrupt or foreign data is treated as no session rather than trusted.
    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch {
      return undefined;
    }
    const parsed = sessionSchema.safeParse(json);
    return parsed.success ? parsed.data : undefined;
  }

  async saveHistory(sessionId: string, session: ChatSession): Promise<void> {
    await withRedis(() =>
      this.redis.set(SESSION_PREFIX + sessionId, JSON.stringify(session), 'KEEPTTL', 'XX'),
    );
  }

  async acquireLock(sessionId: string, token: string, ttlMs: number): Promise<boolean> {
    const result = await withRedis(() =>
      this.redis.set(LOCK_PREFIX + sessionId, token, 'PX', ttlMs, 'NX'),
    );
    return result === 'OK';
  }

  async releaseLock(sessionId: string, token: string): Promise<void> {
    await withRedis(() => this.redis.eval(RELEASE_LOCK, 1, LOCK_PREFIX + sessionId, token));
  }
}
