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
    @Inject(API_CONFIG) config: ApiConfig,
  ) {
    this.limits = config.chat;
    this.lockTtlMs = config.chat.queueWaitMs + AI_LEASE_MS;
  }

  /** Counts a hit and throws `429 rate_limited` once the window's limit is passed. */
  private async enforce(key: string, limit: number, windowSeconds: number): Promise<void> {
    const result = await this.rateLimiter.hit(key, limit, windowSeconds);
    if (!result.allowed) throw rateLimited(result.retryAfterSeconds);
  }

  async createSession(clientBucket: string): Promise<{ sessionId: string; session: ChatSession }> {
    // Don't hand out sessions for a chat that can't answer.
    if (!this.ai.enabled) throw aiDisabled();
    await this.enforce(`ip:${clientBucket}:sessions`, this.limits.ipSessionsPerHour, HOUR_SECONDS);
    const sessionId = newSessionId();
    const session = await this.store.create(sessionId, CHAT_SESSION_TTL_SECONDS);
    return { sessionId, session };
  }

  async sendMessage(
    sessionId: string | undefined,
    message: string,
    clientBucket: string,
    signal: AbortSignal,
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

      // Quotas count messages that would reach the model (not 409s or 401s); a 503 is refunded.
      const ipKey = `ip:${clientBucket}:messages`;
      const sessionKey = `session:${sessionId}:messages`;
      await this.enforce(ipKey, this.limits.ipMessagesPerHour, HOUR_SECONDS);
      await this.enforce(sessionKey, this.limits.sessionMessageLimit, CHAT_SESSION_TTL_SECONDS);

      // Screened after the quotas on purpose: rejected attempts cost quota, so the screen can't
      // be probed for free. Only the screened text reaches retrieval, the model, and history.
      const screened = this.guard.screenMessage(message);
      if (!screened.allowed) {
        this.logger.warn({ message: 'Chat message rejected', reason: screened.reason });
        throw messageRejected();
      }
      const question = screened.message;

      const snippets = this.knowledge.search(
        retrievalQuery(session.history, question),
        RETRIEVAL_LIMIT,
      );
      const messages = buildPrompt(snippets, session.history, question);
      const { reply, links } = this.screenReply(
        await this.completeOrRefund(messages, signal, [ipKey, sessionKey]),
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
  private screenReply(raw: string): ChatMessageResponse {
    const rejection = this.guard.screenReply(raw);
    if (rejection !== undefined) {
      this.logger.warn({ message: 'Chat reply withheld', reason: rejection });
      return { reply: FALLBACK_REPLY, links: [] };
    }
    const { reply, links } = resolveNavigationLinks(raw, this.knowledge);
    return { reply: reply === '' ? FALLBACK_REPLY : reply, links };
  }

  /** A 503 means the model never answered, so the message's quota hits are taken back. */
  private async completeOrRefund(
    messages: AiMessage[],
    signal: AbortSignal,
    quotaKeys: readonly string[],
  ): Promise<string> {
    try {
      return await this.completeWithinCapacity(messages, signal);
    } catch (error) {
      if (error instanceof ApiException && error.getStatus() === HttpStatus.SERVICE_UNAVAILABLE) {
        await Promise.allSettled(quotaKeys.map((key) => this.rateLimiter.refund(key)));
      }
      throw error;
    }
  }

  /** Waits (boundedly) for a global AI slot; overload becomes `503 ai_overloaded`, never a hang. */
  private async completeWithinCapacity(
    messages: AiMessage[],
    signal: AbortSignal,
  ): Promise<string> {
    try {
      return await this.concurrency.run(() => this.complete(messages, signal), signal);
    } catch (error) {
      if (error instanceof AiCapacityError) {
        throw new ApiException(
          HttpStatus.SERVICE_UNAVAILABLE,
          'ai_overloaded',
          'The assistant is busy. Try again shortly.',
          error.retryAfterSeconds,
        );
      }
      throw error;
    }
  }

  private async complete(messages: AiMessage[], signal: AbortSignal): Promise<string> {
    try {
      const completion = await this.ai.complete(
        { messages, maxOutputTokens: MAX_OUTPUT_TOKENS },
        signal,
      );
      return completion.content;
    } catch (error) {
      // Typed provider errors carry no upstream text; map them to client-safe codes.
      if (error instanceof AiDisabledError) throw aiDisabled();
      if (error instanceof AiOverloadedError) {
        throw new ApiException(
          HttpStatus.SERVICE_UNAVAILABLE,
          'ai_overloaded',
          'The assistant is busy. Try again shortly.',
        );
      }
      if (error instanceof AiUnavailableError) {
        throw new ApiException(
          HttpStatus.SERVICE_UNAVAILABLE,
          'ai_unavailable',
          'The assistant is temporarily unavailable.',
        );
      }
      throw error;
    }
  }
}
