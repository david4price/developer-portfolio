import { randomUUID } from 'node:crypto';
import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import type { ChatMessageResponse } from '@portfolio/shared-types';
import { ApiException } from '../../common/api-exception.js';
import { API_CONFIG, type ApiConfig, type ChatConfig } from '../../config/api-config.js';
import {
  AI_PROVIDER,
  AiDisabledError,
  type AiMessage,
  AiOverloadedError,
  type AiProvider,
  AiUnavailableError,
} from '../ai/ai-provider.js';
import { DEFAULT_AI_TIMEOUT_MS } from '../ai/openai-compatible.provider.js';
import {
  CHAT_SESSION_STORE,
  type ChatSession,
  type ChatSessionStore,
  type ChatTurn,
} from './chat-session.store.js';
import { newSessionId } from './chat-cookie.js';
import { buildPrompt, RETRIEVAL_LIMIT, retrievalQuery } from './chat-prompt.js';
import { KNOWLEDGE_BASE, type KnowledgeBase } from './knowledge-base.js';
import {
  AI_CONCURRENCY,
  AiCapacityError,
  type AiConcurrencyLimiter,
  RATE_LIMITER,
  type RateLimiter,
} from './limits.js';
import { MESSAGE_GUARD, type MessageGuard } from './message-guard.js';
import { resolveNavigationLinks } from './navigation-links.js';
import {
  CHALLENGE_REPLAY_STORE,
  type ChallengeReplayStore,
  ChallengeUnavailableError,
  SESSION_CHALLENGE,
  type SessionChallenge,
} from './session-challenge.js';

/** Conversations live for 24 hours (security.md). */
export const CHAT_SESSION_TTL_SECONDS = 24 * 60 * 60;
/** A global AI slot outlives one AI call (timeout plus margin), so a live holder never loses it. */
export const AI_LEASE_MS = DEFAULT_AI_TIMEOUT_MS + 15_000;
const HOUR_SECONDS = 60 * 60;
const MAX_OUTPUT_TOKENS = 400;
/** History kept in Redis. */
const STORED_HISTORY_MAX_TURNS = 20;
/**
 * Sent (and stored) instead of a model reply that was withheld, or that is empty once invalid
 * markers are removed.
 */
export const FALLBACK_REPLY =
  "Sorry, I couldn't put together an answer to that. Try asking about a specific project.";

const busy = () =>
  new ApiException(
    HttpStatus.CONFLICT,
    'chat_busy',
    'A reply is still being generated for this chat. Try again in a moment.',
  );

const sessionRequired = () =>
  new ApiException(
    HttpStatus.UNAUTHORIZED,
    'chat_session_required',
    'Start a chat session first; the previous one may have expired.',
  );

const rateLimited = (retryAfterSeconds: number) =>
  new ApiException(
    HttpStatus.TOO_MANY_REQUESTS,
    'rate_limited',
    'Too many chat requests. Try again later.',
    retryAfterSeconds,
  );

const messageRejected = () =>
  new ApiException(
    HttpStatus.UNPROCESSABLE_ENTITY,
    'message_rejected',
    "The assistant can't answer that message. Ask about the developer's projects, skills, or experience.",
  );

const aiDisabled = () =>
  new ApiException(
    HttpStatus.SERVICE_UNAVAILABLE,
    'ai_disabled',
    'The assistant is not available on this deployment.',
  );

const aiBusy = (retryAfterSeconds?: number) =>
  new ApiException(
    HttpStatus.SERVICE_UNAVAILABLE,
    'ai_overloaded',
    'The assistant is busy. Try again shortly.',
    retryAfterSeconds,
  );

/** AI and capacity errors as client-safe API errors; anything else passes through unchanged. */
function toApiError(error: unknown): unknown {
  if (error instanceof AiCapacityError) return aiBusy(error.retryAfterSeconds);
  if (error instanceof AiOverloadedError) return aiBusy();
  if (error instanceof AiDisabledError) return aiDisabled();
  if (error instanceof AiUnavailableError) {
    return new ApiException(
      HttpStatus.SERVICE_UNAVAILABLE,
      'ai_unavailable',
      'The assistant is temporarily unavailable.',
    );
  }
  return error;
}

/** One counted quota hit: its key and the window it was counted in. */
interface QuotaHit {
  readonly key: string;
  readonly window: string;
}

@Injectable()
export class ChatService {
  private readonly logger = new Logger('ChatService');
  private readonly limits: ChatConfig;
  /** The session lock must outlast queueing for a slot plus the AI call itself. */
  private readonly lockTtlMs: number;

  constructor(
    @Inject(CHAT_SESSION_STORE) private readonly store: ChatSessionStore,
    @Inject(AI_PROVIDER) private readonly ai: AiProvider,
    @Inject(RATE_LIMITER) private readonly rateLimiter: RateLimiter,
    @Inject(AI_CONCURRENCY) private readonly concurrency: AiConcurrencyLimiter,
    @Inject(KNOWLEDGE_BASE) private readonly knowledge: KnowledgeBase,
    @Inject(MESSAGE_GUARD) private readonly guard: MessageGuard,
    @Inject(SESSION_CHALLENGE) private readonly challenge: SessionChallenge,
    @Inject(CHALLENGE_REPLAY_STORE) private readonly challengeReplay: ChallengeReplayStore,
    @Inject(API_CONFIG) config: ApiConfig,
  ) {
    this.limits = config.chat;
    this.lockTtlMs = config.chat.queueWaitMs + AI_LEASE_MS;
  }

  /**
   * Counts a hit and throws `429 rate_limited` once the window's limit is passed. Returns what a
   * refund needs to take back exactly this hit.
   */
  private async enforce(key: string, limit: number, windowSeconds: number): Promise<QuotaHit> {
    const result = await this.rateLimiter.hit(key, limit, windowSeconds);
    if (!result.allowed) throw rateLimited(result.retryAfterSeconds);
    return { key, window: result.window };
  }

  async createSession(
    clientBucket: string,
    token: string | undefined,
  ): Promise<{ sessionId: string; session: ChatSession }> {
    // Don't hand out sessions for a chat that can't answer.
    if (!this.ai.enabled) throw aiDisabled();
    await this.enforce(`ip:${clientBucket}:sessions`, this.limits.ipSessionsPerHour, HOUR_SECONDS);
    // Failed attempts cost quota too, and rate-limited requests never call Siteverify.
    let verified = false;
    if (token !== undefined) {
      try {
        verified = await this.challenge.verify(token);
      } catch (error) {
        if (!(error instanceof ChallengeUnavailableError)) throw error;
        throw new ApiException(
          HttpStatus.SERVICE_UNAVAILABLE,
          'challenge_unavailable',
          'Verification is temporarily unavailable. Try again with a new challenge.',
        );
      }
    }
    if (!verified || token === undefined || !(await this.challengeReplay.claim(token))) {
      throw new ApiException(
        HttpStatus.FORBIDDEN,
        'challenge_failed',
        'Complete a new verification challenge to start a chat.',
      );
    }
    const sessionId = newSessionId();
    const session = await this.store.create(sessionId, CHAT_SESSION_TTL_SECONDS);
    return { sessionId, session };
  }

  async sendMessage(
    sessionId: string | undefined,
    message: string,
    clientBucket: string,
    signal: AbortSignal,
    requestId: string,
  ): Promise<ChatMessageResponse> {
    if (sessionId === undefined) throw sessionRequired();
    if (!this.ai.enabled) throw aiDisabled();
    // Check existence before locking, so unknown IDs never create lock keys.
    if ((await this.store.load(sessionId)) === undefined) throw sessionRequired();

    const lockToken = randomUUID();
    if (!(await this.store.acquireLock(sessionId, lockToken, this.lockTtlMs))) throw busy();

    try {
      // Re-read under the lock: the history may have changed since the first read.
      const session = await this.store.load(sessionId);
      if (session === undefined) throw sessionRequired();

      // Quotas count messages that would reach the model (not 409s or 401s); `generate()` says
      // which 503s are refunded.
      const quota = [
        await this.enforce(
          `ip:${clientBucket}:messages`,
          this.limits.ipMessagesPerHour,
          HOUR_SECONDS,
        ),
        await this.enforce(
          `session:${sessionId}:messages`,
          this.limits.sessionMessageLimit,
          CHAT_SESSION_TTL_SECONDS,
        ),
      ];

      // Screened after the quotas on purpose: rejected attempts cost quota, so the screen can't
      // be probed for free. Only the screened text reaches retrieval, the model, and history.
      const screened = this.guard.screenMessage(message);
      if (!screened.allowed) {
        this.logger.warn({ message: 'Chat message rejected', reason: screened.reason, requestId });
        throw messageRejected();
      }
      const question = screened.message;

      const snippets = this.knowledge.search(
        retrievalQuery(session.history, question),
        RETRIEVAL_LIMIT,
      );
      const messages = buildPrompt(snippets, session.history, question);
      const { reply, links } = this.screenReply(
        requestId,
        await this.generate(messages, signal, quota),
      );

      const history = [
        ...session.history,
        { role: 'user', content: question },
        { role: 'assistant', content: reply },
      ] satisfies ChatTurn[];
      await this.store.saveHistory(sessionId, {
        expiresAt: session.expiresAt,
        history: history.slice(-STORED_HISTORY_MAX_TURNS),
      });
      return { reply, links };
    } finally {
      await this.store.releaseLock(sessionId, lockToken);
    }
  }

  /** Withheld or empty replies become `FALLBACK_REPLY`; markers become validated links. */
  private screenReply(requestId: string, raw: string): ChatMessageResponse {
    const rejection = this.guard.screenReply(raw);
    if (rejection !== undefined) {
      this.logger.warn({ message: 'Chat reply withheld', reason: rejection, requestId });
      return { reply: FALLBACK_REPLY, links: [] };
    }
    const { reply, links } = resolveNavigationLinks(raw, this.knowledge);
    return { reply: reply === '' ? FALLBACK_REPLY : reply, links };
  }

  /**
   * One completion within global capacity. Overload becomes `503 ai_overloaded`, never a hang;
   * typed provider errors become client-safe codes without upstream text. The quota is refunded
   * only when the request certainly used no capacity: an immediate queue-full rejection, or AI
   * switched off. Anything that waited out the queue or reached the provider counts, including a
   * provider "busy": it may follow a long generation, and refunding even quick ones would let a
   * client hammer an overloaded upstream for free.
   */
  private async generate(
    messages: AiMessage[],
    signal: AbortSignal,
    quota: readonly QuotaHit[],
  ): Promise<string> {
    try {
      const completion = await this.concurrency.run(
        () => this.ai.complete({ messages, maxOutputTokens: MAX_OUTPUT_TOKENS }, signal),
        signal,
      );
      return completion.content;
    } catch (error) {
      if ((error instanceof AiCapacityError && !error.waited) || error instanceof AiDisabledError) {
        await Promise.allSettled(
          quota.map(({ key, window }) => this.rateLimiter.refund(key, window)),
        );
      }
      throw toApiError(error);
    }
  }
}
