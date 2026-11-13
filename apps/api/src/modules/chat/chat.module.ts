import { Module } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { API_CONFIG, type ApiConfig } from '../../config/api-config.js';
import { REDIS } from '../../redis/redis.module.js';
import { CHAT_SESSION_STORE } from './chat-session.store.js';
import { ChatController } from './chat.controller.js';
import { AI_LEASE_MS, ChatService } from './chat.service.js';
import { AI_CONCURRENCY, RATE_LIMITER } from './limits.js';
import { RedisChatSessionStore } from './redis-chat-session.store.js';
import { RedisAiConcurrencyLimiter, RedisRateLimiter } from './redis-limits.js';

@Module({
  controllers: [ChatController],
  providers: [
    ChatService,
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
