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
  /**
   * A cheap check of the runtime for the Infrastructure Explorer (P6-04): no prompt, no model
   * run. Adapters without such a check leave it out, and the map shows the model as unknown.
   */
  status?(signal: AbortSignal): Promise<AiStatus>;
}

/**
 * What the runtime said about the configured model:
 * - `ready`: the runtime lists it (listing doesn't prove it loads, only that it's there);
 * - `busy`: `429`/`503`, the same "at capacity or still loading" the chat treats as overload;
 * - `missing`: the runtime answered without it.
 */
export type AiStatus = 'ready' | 'busy' | 'missing';

/** The runtime couldn't be asked. Safe to log: never the reply, the address, or the model. */
export class AiStatusError extends Error {
  constructor(
    readonly reason: AiUnavailableReason,
    readonly upstreamStatus: number | null = null,
  ) {
    super('The AI runtime status could not be read');
    this.name = 'AiStatusError';
  }
}

export class AiDisabledError extends Error {
  constructor() {
    super('AI features are disabled for this deployment');
    this.name = 'AiDisabledError';
  }
}

/** Why a provider call failed. Safe to log: it never carries upstream text or prompt content. */
export type AiUnavailableReason = 'timeout' | 'network' | 'upstream_status' | 'invalid_response';

/**
 * The provider could not produce a completion (timeout, connection failure, error status, or a
 * malformed reply). Maps to `ai_unavailable`. The message is generic on purpose: upstream error
 * bodies can echo prompts or internal details and must never reach clients.
 */
export class AiUnavailableError extends Error {
  constructor(
    readonly reason: AiUnavailableReason,
    readonly upstreamStatus: number | null = null,
  ) {
    super('The AI provider is unavailable');
    this.name = 'AiUnavailableError';
  }
}

/** The provider rejected the call for lack of capacity (429/503). Maps to `ai_overloaded`. */
export class AiOverloadedError extends Error {
  constructor(readonly upstreamStatus: number) {
    super('The AI provider is at capacity');
    this.name = 'AiOverloadedError';
  }
}
