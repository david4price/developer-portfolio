/**
 * A model that scores how likely a visitor message is a prompt-injection or jailbreak attempt.
 * Only `ClassifierMessageGuard` uses it; the chat flow sees the `MessageGuard` port.
 */
export interface InjectionClassifier {
  /** Probability in [0, 1] that `text` is an injection attempt. Rejects when it can't answer. */
  score(text: string): Promise<number>;
}

/** Too many messages are already waiting for the classifier. */
export class InjectionClassifierBusyError extends Error {
  constructor() {
    super('injection classifier queue is full');
    this.name = 'InjectionClassifierBusyError';
  }
}
