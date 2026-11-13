export const CHAT_SESSION_STORE = Symbol('CHAT_SESSION_STORE');

export interface ChatTurn {
  readonly role: 'user' | 'assistant';
  readonly content: string;
}

export interface ChatSession {
  readonly expiresAt: string;
  readonly history: readonly ChatTurn[];
}

/**
 * Server-side chat state. Every key derives from a server-issued session ID; callers never pass a
 * visitor-chosen key. Implementations report backend outages as `DependencyUnavailableError`.
 */
export interface ChatSessionStore {
  /** Creates an empty session that expires after `ttlSeconds`. */
  create(sessionId: string, ttlSeconds: number): Promise<ChatSession>;

  /** Returns the session, or `undefined` if it never existed or has expired. */
  load(sessionId: string): Promise<ChatSession | undefined>;

  /**
   * Replaces the history without extending the session's lifetime. Does nothing if the session
   * expired meanwhile, so an expired session can't be resurrected.
   */
  saveHistory(sessionId: string, session: ChatSession): Promise<void>;

  /** Takes the per-session lock for `ttlMs`; `false` if another request holds it. */
  acquireLock(sessionId: string, token: string, ttlMs: number): Promise<boolean>;

  /** Releases the lock only if `token` still owns it (a timed-out holder can't free a newer one). */
  releaseLock(sessionId: string, token: string): Promise<void>;
}
