import { randomUUID } from 'node:crypto';
import type {
  ChallengeReplayStore,
  ChallengeVerdict,
  SessionChallenge,
} from '../../src/modules/chat/session-challenge.js';

export const sessionPayload = () => ({ turnstileToken: randomUUID() });

export class FakeSessionChallenge implements SessionChallenge {
  readonly tokens: string[] = [];
  failWith: Error | undefined;
  async verify(token: string): Promise<ChallengeVerdict> {
    this.tokens.push(token);
    if (this.failWith !== undefined) throw this.failWith;
    return token === 'invalid'
      ? { verified: false, reasons: ['invalid-input-response'] }
      : { verified: true };
  }
}

export class InMemoryChallengeReplayStore implements ChallengeReplayStore {
  private readonly tokens = new Set<string>();
  async claim(token: string): Promise<boolean> {
    if (this.tokens.has(token)) return false;
    this.tokens.add(token);
    return true;
  }
}
