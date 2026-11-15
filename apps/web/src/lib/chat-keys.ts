interface KeyPress {
  readonly key: string;
  readonly shiftKey: boolean;
  /** True while an input method (e.g. for Japanese or Chinese) is composing text. */
  readonly isComposing: boolean;
}

/** A mouse or trackpad, where Enter-to-send is expected; touch keyboards keep Enter as a new line. */
export const FINE_POINTER_QUERY = '(hover: hover) and (pointer: fine)';

/** Enter sends on desktop; Shift+Enter, IME composition, and touch keyboards add a new line. */
export function sendsOnEnter(press: KeyPress, finePointer: boolean): boolean {
  return finePointer && press.key === 'Enter' && !press.shiftKey && !press.isComposing;
}
