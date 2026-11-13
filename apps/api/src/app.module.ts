import { type DynamicModule, Global, Module } from '@nestjs/common';
import { API_CONFIG, type ApiConfig } from './config/api-config.js';
import { DatabaseModule, POSTGRES_READINESS } from './database/database.module.js';
import { AiModule } from './modules/ai/ai.module.js';
import { ChatModule } from './modules/chat/chat.module.js';
import { HealthModule } from './modules/health/health.module.js';
import { ProjectsModule } from './modules/projects/projects.module.js';
import { REDIS_READINESS, RedisModule } from './redis/redis.module.js';

@Global()
@Module({})
class ConfigModule {
  static register(config: ApiConfig): DynamicModule {
    return {
      module: ConfigModule,
      providers: [{ provide: API_CONFIG, useValue: config }],
      exports: [API_CONFIG],
    };
  }
}

@Module({})
export class AppModule {
  static register(config: ApiConfig): DynamicModule {
    return {
      module: AppModule,
      imports: [
        ConfigModule.register(config),
        DatabaseModule,
        RedisModule,
        AiModule,
        HealthModule.forChecks([POSTGRES_READINESS, REDIS_READINESS]),
        ProjectsModule,
        ChatModule,
      ],
    };
  }
}
