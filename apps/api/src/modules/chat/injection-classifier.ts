/**
 * A model that scores how likely a visitor message is a prompt-injection or jailbreak attempt.
 * Only `ClassifierMessageGuard` uses it; the chat flow sees the `MessageGuard` port.
 */
export interface InjectionClassifier {
  /**
   * Probability in [0, 1] that `text` is an injection attempt. Rejects when it can't answer.
   * Once `signal` aborts, the work frees its queue place at once and is skipped or stopped.
   */
  score(text: string, signal?: AbortSignal): Promise<number>;
  /** Refuses new work, waits for queued work to settle, then frees the model. */
  dispose?(): Promise<void>;
}

/** Too many messages are already waiting for the classifier. */
export class InjectionClassifierBusyError extends Error {
  constructor() {
    super('injection classifier queue is full');
    this.name = 'InjectionClassifierBusyError';
  }
}
