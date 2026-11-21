import type { AiInferenceOutcome, ApiMetrics } from '../../metrics/api-metrics.js';
import {
  type AiCompletion,
  type AiCompletionRequest,
  AiDisabledError,
  AiOverloadedError,
  type AiProvider,
  type AiStatus,
  AiUnavailableError,
} from './ai-provider.js';

function outcomeOf(error: unknown, signal: AbortSignal): AiInferenceOutcome {
  if (signal.aborted) return 'aborted';
  if (error instanceof AiUnavailableError) return error.reason;
  if (error instanceof AiOverloadedError) return 'overloaded';
  if (error instanceof AiDisabledError) return 'disabled';
  return 'error';
}

/** Times every completion of the wrapped provider by outcome; results and errors pass through. */
export class MeteredAiProvider implements AiProvider {
  readonly enabled: boolean;
  readonly status?: (signal: AbortSignal) => Promise<AiStatus>;

  constructor(
    private readonly inner: AiProvider,
    private readonly metrics: ApiMetrics,
  ) {
    this.enabled = inner.enabled;
    // Kept optional: without a check of its own, the provider shows as unknown on the map.
    const status = inner.status?.bind(inner);
    if (status !== undefined) this.status = status;
  }

  async complete(request: AiCompletionRequest, signal: AbortSignal): Promise<AiCompletion> {
    const started = performance.now();
    try {
      const completion = await this.inner.complete(request, signal);
      this.metrics.observeInference('success', (performance.now() - started) / 1_000);
      return completion;
    } catch (error) {
      this.metrics.observeInference(
        outcomeOf(error, signal),
        (performance.now() - started) / 1_000,
      );
      throw error;
    }
  }
}
