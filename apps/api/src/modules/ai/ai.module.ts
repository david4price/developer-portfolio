import { Global, Module } from '@nestjs/common';
import { API_CONFIG, type AiConfig, type ApiConfig } from '../../config/api-config.js';
import { AI_PROVIDER, type AiProvider } from './ai-provider.js';
import { DisabledAiProvider } from './disabled-ai.provider.js';

/** Builds the configured adapter. Unknown or unimplemented providers fail startup loudly. */
export function createAiProvider(config: AiConfig): AiProvider {
  if (!config.enabled) return new DisabledAiProvider();

  throw new Error(
    `AI provider "${config.provider}" is not implemented yet; set AI_ENABLED=false or add an adapter`,
  );
}

@Global()
@Module({
  providers: [
    {
      provide: AI_PROVIDER,
      inject: [API_CONFIG],
      useFactory: (config: ApiConfig) => createAiProvider(config.ai),
    },
  ],
  exports: [AI_PROVIDER],
})
export class AiModule {}
