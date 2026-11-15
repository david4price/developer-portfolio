/**
 * Emoji in model replies. The voice rules forbid them, but small models add them anyway, so the
 * reply is cleaned instead of trusting the prompt. A run is one or more emoji as displayed
 * (Unicode RGI_Emoji: ZWJ families, skin tones, flags, keycaps, and symbols with U+FE0F), plus
 * any zero-width joiners or variation selectors around them, which non-standard sequences such as
 * dog + ZWJ + paw prints would otherwise leave behind. Text symbols that merely could be emoji,
 * such as ©, ™, ↔, or a bare ✔, stay.
 */
const JOINERS = String.raw`(?:\u200D|\uFE0F)*`;
/** Emoji separated only by spaces count as one run, so words around "🐶 🐾" are judged together. */
const RUN = String.raw`${JOINERS}(?:\p{RGI_Emoji}${JOINERS})+(?:[ \t]+${JOINERS}(?:\p{RGI_Emoji}${JOINERS})+)*`;
/** A run that opens a line: keep the indentation, drop the run and the space after it. */
const AT_LINE_START = new RegExp(String.raw`^([ \t]*)${RUN}[ \t]*`, 'gmv');
/** Anywhere else: the run with the space before it, and the space after it at a line end. */
const ELSEWHERE = new RegExp(String.raw`[ \t]*${RUN}(?:[ \t]+$)?`, 'gmv');
/**
 * Ends a word or sentence: a space belongs after it when another word follows. No colon, so
 * "10:🐶30" stays a time.
 */
const ENDS_WORD = /[\p{L}\p{N}\p{Pe}\p{Pf}.,!?;]$/u;
/** Starts a word. Whole code points, so letters outside the BMP (𠮷, 𝐀) count. */
const STARTS_WORD = /^[\p{L}\p{N}]/u;

/** The reply without emoji, tidied so no stray spaces are left and no words run together. */
export function withoutEmoji(reply: string): string {
  return reply
    .replace(AT_LINE_START, '$1')
    .replace(ELSEWHERE, (match: string, offset: number, text: string) => {
      // "dogs🐶cats", "word 🐶cats", and "Great!🐶Next" keep one space; "Finder🐶.",
      // "(🐶see)", and "**🐶Bold**" get none, so brackets and Markdown stay intact.
      const before = text.slice(0, offset);
      const after = text.slice(offset + match.length);
      return ENDS_WORD.test(before) && STARTS_WORD.test(after) ? ' ' : '';
    })
    .trim();
}
