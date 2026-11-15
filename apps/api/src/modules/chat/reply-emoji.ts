/**
 * Emoji in model replies. The voice rules forbid them, but small models add them anyway, so the
 * reply is cleaned instead of trusting the prompt. A run is one or more emoji as displayed
 * (Unicode RGI_Emoji: ZWJ families, skin tones, flags, keycaps, and symbols with U+FE0F). Text
 * symbols that merely could be emoji, such as ©, ™, ↔, or a bare ✔, stay.
 */
const RUN = String.raw`\p{RGI_Emoji}+`;
/** A run that opens a line: keep the indentation, drop the run and the space after it. */
const AT_LINE_START = new RegExp(String.raw`^([ \t]*)${RUN}[ \t]*`, 'gmv');
/** Anywhere else: drop the run with the space before it, and the space after it at a line end. */
const ELSEWHERE = new RegExp(String.raw`[ \t]*${RUN}(?:[ \t]+$)?`, 'gmv');

/** The reply without emoji, tidied so no stray spaces are left where they were. */
export function withoutEmoji(reply: string): string {
  return reply.replace(AT_LINE_START, '$1').replace(ELSEWHERE, '').trim();
}
