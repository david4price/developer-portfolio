import { z } from 'zod';
import { readJsonBody } from '../../common/read-json-body.js';
import {
  type AiCompletion,
  type AiCompletionRequest,
  AiOverloadedError,
  type AiProvider,
  AiUnavailableError,
} from './ai-provider.js';

export interface OpenAiCompatibleOptions {
  /** Base URL up to and including the API version segment, e.g. `http://host:port/v1`. */
  readonly baseUrl: string;
  readonly model: string;
  /** Hard limit for the whole call, including reading the body. */
  readonly timeoutMs?: number;
  /** Upper bound on the response body; larger replies are treated as malformed. */
  readonly maxResponseBytes?: number;
}

export const DEFAULT_AI_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_RESPONSE_BYTES = 256 * 1024;

/** Statuses that mean "busy, try later" rather than "broken". */
const overloadStatuses = new Set([429, 503]);

const completionSchema = z.object({
  choices: z.array(z.object({ message: z.object({ content: z.string() }) })).min(1),
  usage: z.object({ completion_tokens: z.number().int().nonnegative() }).nullish(),
});

/**
 * Adapter for any server that implements OpenAI's `POST /chat/completions` (llama.cpp server,
 * Docker Model Runner, vLLM, LM Studio). Non-streaming, no tools, no credentials.
 */
export class OpenAiCompatibleProvider implements AiProvider {
  readonly enabled = true;
  private readonly endpoint: string;
  private readonly timeoutMs: number;
  private readonly maxResponseBytes: number;

  constructor(private readonly options: OpenAiCompatibleOptions) {
    const base = new URL(options.baseUrl);
    if (base.protocol !== 'http:' && base.protocol !== 'https:') {
      throw new Error('AI base URL must use http or https');
    }
    this.endpoint = `${base.href.replace(/\/+$/, '')}/chat/completions`;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_AI_TIMEOUT_MS;
    this.maxResponseBytes = options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES;
  }

  async complete(request: AiCompletionRequest, signal: AbortSignal): Promise<AiCompletion> {
    if (!Number.isInteger(request.maxOutputTokens) || request.maxOutputTokens < 1) {
      throw new RangeError('maxOutputTokens must be a positive integer');
    }
    if (request.messages.length === 0) {
      throw new RangeError('messages must not be empty');
    }

    const timeout = AbortSignal.timeout(this.timeoutMs);
    const combined = AbortSignal.any([signal, timeout]);

    try {
      const response = await fetch(this.endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({
          model: this.options.model,
          messages: request.messages.map(({ role, content }) => ({ role, content })),
          max_tokens: request.maxOutputTokens,
          stream: false,
        }),
        // A redirect would send the prompt somewhere other than the configured endpoint.
        redirect: 'error',
        signal: combined,
      });

      if (!response.ok) {
        await response.body?.cancel();
        if (overloadStatuses.has(response.status)) throw new AiOverloadedError(response.status);
        throw new AiUnavailableError('upstream_status', response.status);
      }

      const parsed = completionSchema.safeParse(
        await readJsonBody(response, this.maxResponseBytes),
      );
      if (!parsed.success) throw new AiUnavailableError('invalid_response');

      const [choice] = parsed.data.choices;
      return {
        content: choice?.message.content ?? '',
        outputTokens: parsed.data.usage?.completion_tokens ?? null,
      };
    } catch (error) {
      // The caller cancelled (e.g. the client disconnected): propagate its reason unchanged.
      if (signal.aborted) throw signal.reason;
      if (timeout.aborted) throw new AiUnavailableError('timeout');
      if (error instanceof AiUnavailableError || error instanceof AiOverloadedError) throw error;
      throw new AiUnavailableError('network');
    }
  }
}
