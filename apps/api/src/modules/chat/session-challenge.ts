export const SESSION_CHALLENGE = Symbol('SESSION_CHALLENGE');
export const CHALLENGE_REPLAY_STORE = Symbol('CHALLENGE_REPLAY_STORE');

/** Server-side challenge verification. False means rejected; outages throw a typed error. */
export interface SessionChallenge {
  verify(token: string): Promise<boolean>;
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
