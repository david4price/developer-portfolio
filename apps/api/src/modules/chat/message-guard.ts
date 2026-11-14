export const MESSAGE_GUARD = Symbol('MESSAGE_GUARD');

/** Why a visitor message was kept from the model. Logged; never echoed to the visitor. */
export type MessageRejection =
  | 'empty'
  | 'instruction_override'
  | 'prompt_extraction'
  | 'role_injection'
  | 'jailbreak'
  | 'obfuscation';

export type ScreenedMessage =
  | { readonly allowed: true; readonly message: string }
  | { readonly allowed: false; readonly reason: MessageRejection };

/** Why a model reply was withheld from the visitor. */
export type ReplyRejection = 'prompt_leak';

/**
 * Screens everything that crosses the model boundary: visitor messages on the way in, model
 * replies on the way out. The default adapter is rule-based (`heuristic-message-guard.ts`); a
 * model-based classifier can replace it behind this token without touching the chat flow.
 */
export interface MessageGuard {
  /** Normalizes a visitor message for the model, or rejects it as an injection attempt. */
  screenMessage(message: string): ScreenedMessage;
  /** Why `reply` must not reach the visitor, or `undefined` when it may. */
  screenReply(reply: string): ReplyRejection | undefined;
}
