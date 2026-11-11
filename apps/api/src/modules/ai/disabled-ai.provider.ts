import { AiDisabledError, type AiCompletion, type AiProvider } from './ai-provider.js';

/** Default adapter: the deployment runs without any AI provider. */
export class DisabledAiProvider implements AiProvider {
  readonly enabled = false;

  complete(): Promise<AiCompletion> {
    return Promise.reject(new AiDisabledError());
  }
}
