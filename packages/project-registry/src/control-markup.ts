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

/**
 * Text a model must never receive from content: Unicode tag characters (invisible ASCII used to
 * smuggle instructions), bidi overrides and isolates, private-use code points, and control
 * characters other than tab and newline. Joiners, variation selectors, and soft hyphens, which
 * ordinary text uses (emoji sequences, Persian, hyphenation), are not included.
 */
const HIDDEN_TEXT = /[\u{E0000}-\u{E007F}\u202A-\u202E\u2066-\u2069\p{Co}]|(?![\t\n])\p{Cc}/u;

/** True when `text` contains characters that hide content from a reader (`HIDDEN_TEXT`). */
export const containsHiddenText = (text: string) => HIDDEN_TEXT.test(text);

/**
 * Brackets a model may read as `<` or `>`, beyond what NFKC folds. Doubled ones stay doubled. CJK
 * title brackets (〈 〉 《 》) are left alone: 《System Design Interview》 is a book title.
 */
const LOOKALIKES: readonly (readonly [RegExp, string])[] = [
  [/[≪⟪]/g, '<<'],
  [/[≫⟫]/g, '>>'],
  [/[‹⟨❮❬⧼˂ᐸ]/g, '<'],
  [/[›⟩❯❭⧽˃ᐳ]/g, '>'],
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

/**
 * What may follow a tag name before its `>`: real attributes only (`lang="en"`, `hidden`). Prose
 * after a `<` ("load < system capacity -> add pods") isn't attribute-shaped, so it never counts.
 */
const ATTRIBUTES = String.raw`(?:\s+[a-z][\w-]*(?:\s*=\s*(?:"[^"<>]*"|'[^'<>]*'|[^\s<>"']+))?){0,10}\s*\/?`;

const PATTERNS: readonly (readonly [ControlMarkupKind, RegExp])[] = [
  // The data block's tag, with a separator (so `<PortfolioData />` isn't it), punctuation glued
  // to the name (`</portfolio_data!>`), and attributes.
  [
    'data_delimiter',
    new RegExp(String.raw`<\s*\/?\s*portfolio[\s_-]+data(?![\w-])[^\s<>]{0,20}${ATTRIBUTES}>`),
  ],
  // `<|im_start|>`, `<｜begin▁of▁sentence｜>`, `[INST]`, `<<SYS>>`. Token names have no spaces, so
  // pipe operators (Elm's `f <| g x |> h`) and shifts (`a << sys >> 2`) are code, not tokens.
  ['template_token', /<\|[^\s|<>]{1,40}\|>|\[\/?inst\]|<<\/?sys>>/],
  // `<system>`, `</assistant-turn>`, `<instructions lang="en">`, standing on their own: a `<`
  // glued to a word is a generic (`Dictionary<System.String, int>`, `Task<Instructions>`).
  [
    'role_tag',
    new RegExp(
      String.raw`(?<![\w.])<\s*\/?\s*(?:system|assistant|developer|instructions?)(?:[_-]?(?:prompt|message|turn))?(?![\w.-])${ATTRIBUTES}>`,
    ),
  ],
];

/** Every kind of control markup found in `text`; empty when there is none. */
export function controlMarkupIn(text: string): ReadonlySet<ControlMarkupKind> {
  const view = normalizedView(text);
  return new Set(PATTERNS.filter(([, pattern]) => pattern.test(view)).map(([kind]) => kind));
}
