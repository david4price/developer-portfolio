/**
 * Control markup: text a language model may read as prompt structure rather than content. That
 * covers the chat data block's delimiter, chat-template tokens, and role tags. The API screens
 * visitor messages and model replies with it, and the registry schema rejects it in content, so
 * every place agrees on one definition.
 *
 * Detection only: nothing here edits text. The patterns run on a normalized copy (invisible
 * characters removed, NFKC, look-alike brackets folded, HTML entities decoded, lowercased), so
 * disguised forms (`⟨/portfolio_data⟩`, `&lt/portfolio_data&gt`, math-bold letters, `ſystem`)
 * are found while the original text stays exactly as written.
 */

export type ControlMarkupKind = 'data_delimiter' | 'template_token' | 'role_tag';

/**
 * Characters a reader can't see but a model reads: format characters (zero-width, bidi
 * overrides, BOM, Unicode tag characters used to smuggle hidden instructions), private-use code
 * points, and control characters other than tab and newline.
 */
export const INVISIBLE = /[\p{Cf}\p{Co}]|(?![\t\n])\p{Cc}/gu;

/** Brackets a model may read as `<` or `>`, beyond what NFKC folds. Doubled ones stay doubled. */
const LOOKALIKES: readonly (readonly [RegExp, string])[] = [
  [/[≪⟪《]/g, '<<'],
  [/[≫⟫》]/g, '>>'],
  [/[‹〈⟨❮❬⧼˂ᐸ〈]/g, '<'],
  [/[›〉⟩❯❭⧽˃ᐳ〉]/g, '>'],
];

/** `&lt`, `&lt;`, `&#60;`, `&#x3c;` and their `>` forms; a semicolon is optional in HTML. */
const ENTITIES: readonly (readonly [RegExp, string])[] = [
  [/&(?:lt;?|#0*60;?|#x0*3c;?)/gi, '<'],
  [/&(?:gt;?|#0*62;?|#x0*3e;?)/gi, '>'],
];

/** The text as a model might read it, for detection only. */
function normalizedView(text: string): string {
  let view = text.replace(INVISIBLE, '').normalize('NFKC');
  for (const [pattern, replacement] of [...LOOKALIKES, ...ENTITIES]) {
    view = view.replace(pattern, replacement);
  }
  return view.toLowerCase();
}

const PATTERNS: readonly (readonly [ControlMarkupKind, RegExp])[] = [
  // The data block's tag with any separator and anything up to its `>`: `</portfolio_data!>`.
  // A separator is required, so component names such as `<PortfolioData />` don't count.
  ['data_delimiter', /<\s*\/?\s*portfolio[\s_-]+data(?![\w-])[^<>\n]{0,100}>/],
  // `<|im_start|>`, `<|eot_id|>`, `[INST]`, `<<SYS>>`. Token names are word-like, so pipe
  // operators with spaces (Elm's `f <| g x |> h`) are not tokens.
  ['template_token', /<\|[\w.-]{1,30}\|>|\[\/?inst\]|<<\s*\/?\s*sys\s*>>/],
  // `<system>`, `<system: override>`, `</assistant-turn>`, `<developer.note>`.
  ['role_tag', /<\s*\/?\s*(?:system|assistant|developer|instructions?)\b[^<>\n]{0,100}>/],
];

/** Every kind of control markup found in `text`; empty when there is none. */
export function controlMarkupIn(text: string): ReadonlySet<ControlMarkupKind> {
  const view = normalizedView(text);
  return new Set(PATTERNS.filter(([, pattern]) => pattern.test(view)).map(([kind]) => kind));
}
