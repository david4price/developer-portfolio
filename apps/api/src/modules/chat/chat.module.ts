import { Module } from '@nestjs/common';
import { docNotes, profile, registry } from '@portfolio/project-registry';
import type { Redis } from 'ioredis';
import { API_CONFIG, type ApiConfig } from '../../config/api-config.js';
import { ApiMetrics } from '../../metrics/api-metrics.js';
import { REDIS } from '../../redis/redis.module.js';
import { CHAT_SESSION_STORE } from './chat-session.store.js';
import { ChatController } from './chat.controller.js';
import { AI_LEASE_MS, ChatService } from './chat.service.js';
import { ClassifierMessageGuard } from './classifier-message-guard.js';
import { HeuristicMessageGuard } from './heuristic-message-guard.js';
import { KNOWLEDGE_BASE } from './knowledge-base.js';
import { AI_CONCURRENCY, RATE_LIMITER } from './limits.js';
import { MeteredAiConcurrencyLimiter } from './metered-ai-concurrency.js';
import { MESSAGE_GUARD, type MessageGuard } from './message-guard.js';
import { OnnxInjectionClassifier } from './onnx-injection-classifier.js';
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
          : { verify: async () => ({ verified: false, reasons: ['challenge-disabled'] }) },
    },
    {
      provide: CHALLENGE_REPLAY_STORE,
      inject: [REDIS],
      useFactory: (redis: Redis) => new RedisChallengeReplayStore(redis),
    },
    {
      provide: KNOWLEDGE_BASE,
      useFactory: () => new RegistryKnowledgeBase(registry, docNotes, profile),
    },
    {
      provide: MESSAGE_GUARD,
      inject: [API_CONFIG],
      useFactory: async ({ chat: { guard } }: ApiConfig): Promise<MessageGuard> => {
        const rules = new HeuristicMessageGuard();
        if (guard.kind === 'rules') return rules;
        // Loaded at startup (about a second), so a missing or corrupt model stops the pod
        // instead of silently screening with rules only.
        const classifier = await OnnxInjectionClassifier.load(guard.modelDir);
        return new ClassifierMessageGuard(rules, classifier, guard);
      },
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
      inject: [REDIS, API_CONFIG, ApiMetrics],
      useFactory: (redis: Redis, config: ApiConfig, metrics: ApiMetrics) =>
        new MeteredAiConcurrencyLimiter(
          new RedisAiConcurrencyLimiter(redis, {
            limit: config.chat.maxConcurrency,
            queueMax: config.chat.queueMax,
            queueWaitMs: config.chat.queueWaitMs,
            leaseMs: AI_LEASE_MS,
          }),
          metrics,
        ),
    },
  ],
})
export class ChatModule {}
