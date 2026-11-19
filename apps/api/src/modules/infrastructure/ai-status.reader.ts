import { z } from 'zod';
import { readJsonBody } from '../../common/read-json-body.js';

/**
 * What the model runtime said when asked for its model list (P6-04):
 * - `ready`: it answered and lists the configured model;
 * - `busy`: it answered 429/503 (at capacity, or still loading);
 * - `missing`: it answered, but the configured model isn't in the list.
 */
export type AiStatus = 'ready' | 'busy' | 'missing';

/** Optional source for the map's AI building; its failure must not hide the workload snapshot. */
export interface AiStatusReader {
  read(signal: AbortSignal): Promise<AiStatus>;
}

/** The runtime couldn't be asked. Safe to log: never the response body or the model's name. */
export class AiStatusError extends Error {
  constructor(
    readonly reason: 'timeout' | 'network' | 'status' | 'invalid_response',
    readonly status: number | null = null,
  ) {
    super('The AI runtime status could not be read');
    this.name = 'AiStatusError';
  }
}

const BUSY_STATUSES = new Set([429, 503]);
const DEFAULT_MAX_RESPONSE_BYTES = 64 * 1024;

const modelListSchema = z.object({ data: z.array(z.object({ id: z.string() })) });

export interface ModelListStatusOptions {
  /** The chat adapter's base URL, up to and including the version segment. */
  readonly baseUrl: string;
  /** The configured model; only compared, never returned or logged. */
  readonly model: string;
  readonly maxResponseBytes?: number;
}

/**
 * Asks an OpenAI-compatible runtime for `GET /models`. That lists what the runtime can serve
 * without running the model, so it costs no GPU time and sends no prompt. The reply is used
 * only to compare against the configured model; nothing from it reaches the snapshot.
 */
export class ModelListStatusReader implements AiStatusReader {
  private readonly endpoint: string;
  private readonly maxResponseBytes: number;

  constructor(private readonly options: ModelListStatusOptions) {
    const base = new URL(options.baseUrl);
    if (base.protocol !== 'http:' && base.protocol !== 'https:') {
      throw new Error('AI base URL must use http or https');
    }
    this.endpoint = `${base.href.replace(/\/+$/, '')}/models`;
    this.maxResponseBytes = options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES;
  }

  async read(signal: AbortSignal): Promise<AiStatus> {
    let response: Response;
    try {
      response = await fetch(this.endpoint, {
        headers: { accept: 'application/json' },
        // Same as the chat adapter: only the configured endpoint is ever asked.
        redirect: 'error',
        signal,
      });
    } catch {
      throw new AiStatusError(signal.aborted ? 'timeout' : 'network');
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      if (BUSY_STATUSES.has(response.status)) return 'busy';
      throw new AiStatusError('status', response.status);
    }
    let body: unknown;
    try {
      body = await readJsonBody(response, this.maxResponseBytes);
    } catch {
      throw new AiStatusError(signal.aborted ? 'timeout' : 'network');
    }
    const parsed = modelListSchema.safeParse(body);
    if (!parsed.success) throw new AiStatusError('invalid_response');
    return parsed.data.data.some(({ id }) => id === this.options.model) ? 'ready' : 'missing';
  }
}
