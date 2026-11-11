export const AI_PROVIDER = Symbol('AI_PROVIDER');

export interface AiMessage {
  readonly role: 'system' | 'user' | 'assistant';
  readonly content: string;
}

export interface AiCompletionRequest {
  readonly messages: readonly AiMessage[];
  readonly maxOutputTokens: number;
}

export interface AiCompletion {
  readonly content: string;
  readonly outputTokens: number | null;
}

/**
 * Port for text generation. Adapters are selected by deployment configuration only; callers never
 * see provider names, endpoints, or credentials.
 */
export interface AiProvider {
  readonly enabled: boolean;
  complete(request: AiCompletionRequest, signal: AbortSignal): Promise<AiCompletion>;
}

export class AiDisabledError extends Error {
  constructor() {
    super('AI features are disabled for this deployment');
    this.name = 'AiDisabledError';
  }
}
