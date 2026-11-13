import { Module } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { REDIS } from '../../redis/redis.module.js';
import { CHAT_SESSION_STORE } from './chat-session.store.js';
import { ChatController } from './chat.controller.js';
import { ChatService } from './chat.service.js';
import { RedisChatSessionStore } from './redis-chat-session.store.js';

@Module({
  controllers: [ChatController],
  providers: [
    ChatService,
    {
      provide: CHAT_SESSION_STORE,
      inject: [REDIS],
      useFactory: (redis: Redis) => new RedisChatSessionStore(redis),
    },
  ],
})
export class ChatModule {}
