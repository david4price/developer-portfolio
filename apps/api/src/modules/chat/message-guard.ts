export const MESSAGE_GUARD = Symbol('MESSAGE_GUARD');

/** Why a visitor message was kept from the model. Logged; never echoed to the visitor. */
export type MessageRejection =
  | 'empty'
  | 'instruction_override'
  | 'prompt_extraction'
  | 'role_injection'
  | 'jailbreak'
  | 'obfuscation'
  /** The rules passed it, but the injection classifier scored it at or above its threshold. */
  | 'classified_injection';

export type ScreenedMessage =
  | { readonly allowed: true; readonly message: string }
  | { readonly allowed: false; readonly reason: MessageRejection };

/** Why a model reply was withheld from the visitor. */
export type ReplyRejection = 'prompt_leak';

/**
 * Screens everything that crosses the model boundary: visitor messages on the way in, model
 * replies on the way out. The default adapter is rule-based (`heuristic-message-guard.ts`);
 * `classifier-message-guard.ts` adds a CPU injection classifier after the rules (P5-08).
 */
export interface MessageGuard {
  /**
   * Normalizes a visitor message for the model, or rejects it as an injection attempt. Throws
   * `ScreeningUnavailableError` when the message couldn't be fully screened: it must not reach
   * the model then (P7-08).
   */
  screenMessage(message: string): Promise<ScreenedMessage>;
  /** Why `reply` must not reach the visitor, or `undefined` when it may. */
  screenReply(reply: string): ReplyRejection | undefined;
}

/**
 * Why a message got no complete screening: the classifier's queue was full (`busy`, no work
 * done), it ran past its time budget (`timeout`), or it failed (`error`).
 */
export type ScreeningUnavailableReason = 'busy' | 'timeout' | 'error';

/**
 * Screening couldn't finish (P7-08: fail closed), so the message must not reach the model.
 * `started` says whether the classifier spent CPU on it, or only queued it: the chat refunds the
 * quota only for the latter, and tells a message that timed out while being scored to be shorter.
 */
export class ScreeningUnavailableError extends Error {
  constructor(
    readonly reason: ScreeningUnavailableReason,
    readonly started: boolean,
  ) {
    super('Message screening is unavailable');
    this.name = 'ScreeningUnavailableError';
  }
}
