import { Global, Module } from '@nestjs/common';
import { API_CONFIG, type AiConfig, type ApiConfig } from '../../config/api-config.js';
import { AI_PROVIDER, type AiProvider } from './ai-provider.js';
import { DisabledAiProvider } from './disabled-ai.provider.js';
import { OpenAiCompatibleProvider } from './openai-compatible.provider.js';

/** Builds the configured adapter. Unknown or unimplemented providers fail startup loudly. */
export function createAiProvider(config: AiConfig): AiProvider {
  if (!config.enabled) return new DisabledAiProvider();

  if (config.provider === 'openai-compatible') {
    if (config.baseUrl === null) {
      throw new Error('AI_BASE_URL is required for the openai-compatible provider');
    }
    return new OpenAiCompatibleProvider({ baseUrl: config.baseUrl, model: config.model });
  }

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
