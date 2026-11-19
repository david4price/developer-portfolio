import { z } from 'zod';
import { readJsonBody } from '../../common/read-json-body.js';
import {
  type AiCompletion,
  type AiCompletionRequest,
  AiOverloadedError,
  type AiProvider,
  type AiStatus,
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

/**
 * "Busy, try later" rather than "broken": a `429`, or a `503` that is the runtime's own JSON
 * error. A non-JSON `503` is a proxy's page in front of a runtime that's gone.
 */
const isOverload = (reply: { readonly status: number; readonly json: boolean }) =>
  reply.status === 429 || (reply.status === 503 && reply.json);

/**
 * How llama.cpp's server tags its model list; it answers with its loaded model whatever a request
 * names.
 */
const LLAMA_CPP_OWNER = 'llamacpp';

const modelListSchema = z.object({
  data: z.array(z.object({ id: z.string(), owned_by: z.string().optional() })),
});

const completionSchema = z.object({
  choices: z.array(z.object({ message: z.object({ content: z.string() }) })).min(1),
  usage: z.object({ completion_tokens: z.number().int().nonnegative() }).nullish(),
});

/** A runtime reply: the body for a 2xx, otherwise only the status and whether it was JSON. */
type Reply =
  | { readonly ok: true; readonly body: unknown }
  | { readonly ok: false; readonly status: number; readonly json: boolean };

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

    const reply = await this.send(
      this.endpoint,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          model: this.options.model,
          messages: request.messages.map(({ role, content }) => ({ role, content })),
          max_tokens: request.maxOutputTokens,
          stream: false,
        }),
      },
      signal,
      this.maxResponseBytes,
    );
    if (!reply.ok) {
      if (isOverload(reply)) throw new AiOverloadedError(reply.status);
      throw new AiUnavailableError('upstream_status', reply.status);
    }
    const parsed = completionSchema.safeParse(reply.body);
    if (!parsed.success) throw new AiUnavailableError('invalid_response');
    const [choice] = parsed.data.choices;
    return {
      content: choice?.message.content ?? '',
      outputTokens: parsed.data.usage?.completion_tokens ?? null,
    };
  }

  /**
   * `GET /models`: what the runtime has, without running anything. The configured model must be
   * listed under exactly the name chat sends (vLLM, LM Studio, and Docker Model Runner match it
   * exactly). A llama.cpp server listing a single model counts too: it serves that model
   * whatever a request names. Busy follows chat's overload rule.
   */
  async status(signal: AbortSignal): Promise<AiStatus> {
    let reply: Reply;
    try {
      reply = await this.send(this.modelsEndpoint, {}, signal, MAX_MODEL_LIST_BYTES);
    } catch (error) {
      // The caller's deadline is a timeout here, not a cancellation to pass on.
      if (signal.aborted) throw new AiUnavailableError('timeout');
      throw error;
    }
    if (!reply.ok) {
      if (isOverload(reply)) return 'busy';
      throw new AiUnavailableError('upstream_status', reply.status);
    }
    const parsed = modelListSchema.safeParse(reply.body);
    if (!parsed.success) throw new AiUnavailableError('invalid_response');
    const models = parsed.data.data;
    const listed =
      models.some(({ id }) => id === this.options.model) ||
      (models.length === 1 && models[0]?.owned_by === LLAMA_CPP_OWNER);
    return listed ? 'ready' : 'missing';
  }

  /**
   * One request to the configured runtime, shared by chat and the status check: JSON accepted,
   * redirects refused (they would send a prompt elsewhere), bounded by `timeoutMs` and `signal`,
   * error bodies discarded unread, and 2xx bodies read up to `maxBytes`. The caller's own abort
   * propagates its reason unchanged; everything else becomes `AiUnavailableError`.
   */
  private async send(
    url: string,
    init: { method?: string; headers?: Record<string, string>; body?: string },
    signal: AbortSignal,
    maxBytes: number,
  ): Promise<Reply> {
    const timeout = AbortSignal.timeout(this.timeoutMs);
    const combined = AbortSignal.any([signal, timeout]);
    try {
      const response = await fetch(url, {
        ...init,
        headers: { ...init.headers, accept: 'application/json' },
        redirect: 'error',
        signal: combined,
      });
      if (!response.ok) {
        await response.body?.cancel().catch(() => undefined);
        const type = response.headers.get('content-type') ?? '';
        return { ok: false, status: response.status, json: /\bjson\b/i.test(type) };
      }
      return { ok: true, body: await readJsonBody(response, maxBytes) };
    } catch {
      if (signal.aborted) throw signal.reason;
      throw new AiUnavailableError(timeout.aborted ? 'timeout' : 'network');
    }
  }
}
