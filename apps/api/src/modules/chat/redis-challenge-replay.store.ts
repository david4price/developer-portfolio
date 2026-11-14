import { createHash } from 'node:crypto';
import type { Redis } from 'ioredis';
import { DependencyUnavailableError } from '../../common/dependency-unavailable.error.js';
import type { ChallengeReplayStore } from './session-challenge.js';

const TOKEN_LIFETIME_SECONDS = 300;
const PREFIX = 'portfolio:chat:challenge:';

/** Redis sees only SHA-256 digests; SET NX ensures that one verified token grants one session. */
export class RedisChallengeReplayStore implements ChallengeReplayStore {
  constructor(private readonly redis: Redis) {}

  async claim(token: string): Promise<boolean> {
    const digest = createHash('sha256').update(token).digest('hex');
    try {
      return (
        (await this.redis.set(PREFIX + digest, '1', 'EX', TOKEN_LIFETIME_SECONDS, 'NX')) === 'OK'
      );
    } catch {
      throw new DependencyUnavailableError('redis');
    }
  }
}
