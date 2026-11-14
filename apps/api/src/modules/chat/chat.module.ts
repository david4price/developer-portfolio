import { Module } from '@nestjs/common';
import { registry } from '@portfolio/project-registry';
import type { Redis } from 'ioredis';
import { API_CONFIG, type ApiConfig } from '../../config/api-config.js';
import { REDIS } from '../../redis/redis.module.js';
import { CHAT_SESSION_STORE } from './chat-session.store.js';
import { ChatController } from './chat.controller.js';
import { AI_LEASE_MS, ChatService } from './chat.service.js';
import { HeuristicMessageGuard } from './heuristic-message-guard.js';
import { KNOWLEDGE_BASE } from './knowledge-base.js';
import { AI_CONCURRENCY, RATE_LIMITER } from './limits.js';
import { MESSAGE_GUARD } from './message-guard.js';
import { RedisChatSessionStore } from './redis-chat-session.store.js';
import { RegistryKnowledgeBase } from './registry-knowledge-base.js';
import { RedisAiConcurrencyLimiter, RedisRateLimiter } from './redis-limits.js';
import { CloudflareSessionChallenge } from './cloudflare-session-challenge.js';
import { RedisChallengeReplayStore } from './redis-challenge-replay.store.js';
import {
  CHALLENGE_REPLAY_STORE,
  SESSION_CHALLENGE,
  type SessionChallenge,
} from './session-challenge.js';

@Module({
  controllers: [ChatController],
  providers: [
    ChatService,
    {
      provide: SESSION_CHALLENGE,
      inject: [API_CONFIG],
      useFactory: (config: ApiConfig): SessionChallenge =>
        config.turnstile.enabled
          ? new CloudflareSessionChallenge(config.turnstile)
          : { verify: async () => false },
    },
    {
      provide: CHALLENGE_REPLAY_STORE,
      inject: [REDIS],
      useFactory: (redis: Redis) => new RedisChallengeReplayStore(redis),
    },
    {
      provide: KNOWLEDGE_BASE,
      useFactory: () => new RegistryKnowledgeBase(registry),
    },
    {
      provide: MESSAGE_GUARD,
      useFactory: () => new HeuristicMessageGuard(),
    },
    {
      provide: CHAT_SESSION_STORE,
      inject: [REDIS],
      useFactory: (redis: Redis) => new RedisChatSessionStore(redis),
    },
    {
      provide: RATE_LIMITER,
      inject: [REDIS],
      useFactory: (redis: Redis) => new RedisRateLimiter(redis),
    },
    {
      provide: AI_CONCURRENCY,
      inject: [REDIS, API_CONFIG],
      useFactory: (redis: Redis, config: ApiConfig) =>
        new RedisAiConcurrencyLimiter(redis, {
          limit: config.chat.maxConcurrency,
          queueMax: config.chat.queueMax,
          queueWaitMs: config.chat.queueWaitMs,
          leaseMs: AI_LEASE_MS,
        }),
    },
  ],
})
export class ChatModule {}
