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
 * Text a model must never receive from content, because a reader can't see it: Unicode tag
 * characters (invisible ASCII used to smuggle instructions), supplementary variation selectors and
 * runs of basic ones, and runs of zero-width characters (all three can encode a payload);
 * interlinear annotations (hidden by renderers); bidi overrides and isolates; private-use code
 * points; and control characters other than tab, newline, and carriage return. A single emoji
 * selector, an ideographic variation selector after a CJK ideograph, a single joiner (emoji
 * sequences, Persian), soft hyphens, and LRM/RLM marks (needed by right-to-left text, hiding
 * nothing) are allowed.
 */
const HIDDEN_TEXT =
  /[\u{E0000}-\u{E007F}\uFFF9-\uFFFB\u202A-\u202E\u2066-\u2069\p{Co}]|(?<!\p{Ideographic})[\u{E0100}-\u{E01EF}]|\p{Variation_Selector}{2,}|[\u200B-\u200D\u2060-\u2064\uFEFF]{2,}|(?![\t\n\r])\p{Cc}/u;

/** True when `text` contains characters that hide content from a reader (`HIDDEN_TEXT`). */
export const containsHiddenText = (text: string) => HIDDEN_TEXT.test(text);

/** Angle brackets that NFKC would turn into CJK title brackets, folded before it runs. */
const BEFORE_NFKC: readonly (readonly [RegExp, string])[] = [
  [/\u2329/g, '<'],
  [/\u232A/g, '>'],
];

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
  // Line breaks stay line breaks (a lone CR must not glue a tag to the previous word).
  let view = text.replace(/\r\n?/g, '\n').replace(INVISIBLE, '');
  for (const [pattern, replacement] of BEFORE_NFKC) view = view.replace(pattern, replacement);
  view = view.normalize('NFKC');
  for (const [pattern, replacement] of [...LOOKALIKES, ...ENTITIES]) {
    view = view.replace(pattern, replacement);
  }
  // Combining marks (accents, variation selectors, the dot `\u0130` leaves after lowercasing) can't
  // hide a name either.
  return view.toLowerCase().normalize('NFKD').replace(/\p{M}/gu, '');
}

/**
 * What may follow a tag name before its `>`: real attributes only (`lang="en"`, `title="a>b"`).
 * Prose after a `<` ("load < system capacity -> add pods") isn't attribute-shaped, so it never
 * counts.
 */
const ATTRIBUTES = String.raw`(?:\s+[a-z][\w-]*(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s<>"']+))?){0,10}\s*\/?\s*`;

const PATTERNS: readonly (readonly [ControlMarkupKind, RegExp])[] = [
  // The data block's tag. Its identifier forms (`portfolio_data`, `portfolio-data`) count after
  // any `<` whatever follows (`</portfolio_data 1>`, cut off); the plain words "portfolio data"
  // need a `>` or real attributes, so "costs < portfolio data budget" stays prose. Component
  // names such as `<PortfolioData />` or `<portfolio-data-sync>` are not it.
  [
    'data_delimiter',
    new RegExp(
      String.raw`<\s*\/?\s*portfolio(?=[\s_-]*[_-])[\s_-]+data(?![\w-])|<\s*\/?\s*portfolio\s+data(?![\w-])[^\s<>]{0,20}${ATTRIBUTES}>`,
    ),
  ],
  // `<|im_start|>`, `<｜begin▁of▁sentence｜>`, `[INST]`, `<<SYS>>`, `《SYS》`. Token names have no
  // spaces, so pipe operators (Elm's `f <| g x |> h`) and shifts (`a << sys >> 2`) are code.
  ['template_token', /<\|[^\s|<>]{1,40}\|>|\[\/?inst\]|<<\/?sys>>|《\/?sys》/],
  // `<system>`, `</system>`, `<system-reminder>`, `<system_v2>`, `<assistant_response lang="en">`.
  // Suffixes come from a fixed list, so components such as `<system-status>` or
  // `<developer-card>` aren't tags. Closing tags always count; an opening `<` glued to a word is a
  // generic (`Task<Instructions>`, `Dictionary<System.String, int>`), but one after punctuation
  // (`Thanks.<system>`) is a tag.
  [
    'role_tag',
    new RegExp(
      String.raw`(?:(?<!\w)<|<\s*\/)\s*(?:system|assistant|developer|instructions?)(?:[_:-]?(?:prompt|message|turn|reminder|response|instructions?|context|note|role|v?\d+))*(?![\w.-])${ATTRIBUTES}>`,
    ),
  ],
];

/** Every kind of control markup found in `text`; empty when there is none. */
export function controlMarkupIn(text: string): ReadonlySet<ControlMarkupKind> {
  const view = normalizedView(text);
  return new Set(PATTERNS.filter(([, pattern]) => pattern.test(view)).map(([kind]) => kind));
}
