import { z } from 'zod';
import { readJsonBody } from '../../common/read-json-body.js';
import {
  type AiCompletion,
  type AiCompletionRequest,
  AiOverloadedError,
  type AiProvider,
  type AiStatus,
  AiStatusError,
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
const MAX_MODEL_LIST_BYTES = 64 * 1024;

/** Statuses that mean "busy, try later" rather than "broken". */
const overloadStatuses = new Set([429, 503]);

const modelListSchema = z.object({ data: z.array(z.object({ id: z.string() })) });

/**
 * Model ids as runtimes spell them: case aside, Docker Model Runner and Ollama treat a missing
 * tag as `:latest`.
 */
const modelKey = (id: string) => id.toLowerCase().replace(/:latest$/, '');

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
  private readonly modelsEndpoint: string;
  private readonly timeoutMs: number;
  private readonly maxResponseBytes: number;

  constructor(private readonly options: OpenAiCompatibleOptions) {
    const base = new URL(options.baseUrl);
    if (base.protocol !== 'http:' && base.protocol !== 'https:') {
      throw new Error('AI base URL must use http or https');
    }
    const root = base.href.replace(/\/+$/, '');
    this.endpoint = `${root}/chat/completions`;
    this.modelsEndpoint = `${root}/models`;
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

  /**
   * `GET /models`: what the runtime has, without running anything. A runtime that lists exactly
   * one model (llama.cpp's server, which answers every request with its loaded model whatever
   * the request names) counts as ready.
   */
  async status(signal: AbortSignal): Promise<AiStatus> {
    let response: Response;
    try {
      response = await fetch(this.modelsEndpoint, {
        headers: { accept: 'application/json' },
        redirect: 'error',
        signal,
      });
    } catch {
      throw new AiStatusError(signal.aborted ? 'timeout' : 'network');
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      if (overloadStatuses.has(response.status)) return 'busy';
      throw new AiStatusError('upstream_status', response.status);
    }
    let body: unknown;
    try {
      body = await readJsonBody(response, MAX_MODEL_LIST_BYTES);
    } catch {
      throw new AiStatusError(signal.aborted ? 'timeout' : 'network');
    }
    const parsed = modelListSchema.safeParse(body);
    if (!parsed.success) throw new AiStatusError('invalid_response');
    const models = parsed.data.data;
    const wanted = modelKey(this.options.model);
    if (models.length === 1 || models.some(({ id }) => modelKey(id) === wanted)) return 'ready';
    return 'missing';
  }
}
