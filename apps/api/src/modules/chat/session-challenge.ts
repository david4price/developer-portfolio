export const SESSION_CHALLENGE = Symbol('SESSION_CHALLENGE');
export const CHALLENGE_REPLAY_STORE = Symbol('CHALLENGE_REPLAY_STORE');

/**
 * The outcome of verifying a challenge token. A rejection carries reasons that are safe to log:
 * Siteverify's own error codes (validated to a fixed shape) or a claim that didn't match, never
 * the token, hostname, or secret.
 */
export type ChallengeVerdict =
  { readonly verified: true } | { readonly verified: false; readonly reasons: readonly string[] };

/** Server-side challenge verification. Outages throw `ChallengeUnavailableError`. */
export interface SessionChallenge {
  verify(token: string): Promise<ChallengeVerdict>;
}

/** Atomically claims a verified token for its remaining lifetime, across API replicas. */
export interface ChallengeReplayStore {
  claim(token: string): Promise<boolean>;
}

export class ChallengeUnavailableError extends Error {
  constructor() {
    super('Challenge verification unavailable');
    this.name = 'ChallengeUnavailableError';
  }
}
