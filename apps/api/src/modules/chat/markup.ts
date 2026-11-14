/**
 * Control markup: text a model may read as structure rather than content. That covers the data
 * block's delimiter, chat-template tokens, and role tags. Retrieved data, visitor messages, and
 * replies all use these definitions, so the three checks can't drift apart.
 *
 * Matching runs on a view of the text in which look-alike brackets count as `<` and `>`, and
 * full-width ASCII counts as ASCII. Every substitution maps one UTF-16 unit to one, so a match in
 * the view marks the same span in the original. Removal cuts those spans from the original, so
 * everything else (`Array<string>`, `10⁶`, `⟨x⟩` in prose) stays exactly as written.
 */

/**
 * Characters a reader can't see but a model reads: format characters (zero-width, bidi
 * overrides, BOM, Unicode tag characters used to smuggle hidden instructions), private-use code
 * points, and control characters other than tab and newline.
 */
export const INVISIBLE = /[\p{Cf}\p{Co}]|(?![\t\n])\p{Cc}/gu;

/** Brackets a model may read as `<` or `>`. All are single UTF-16 units. */
const LOOKALIKE_OPEN = /[‹〈⟨❮❬⧼˂ᐸ≪⟪﹤]/g;
const LOOKALIKE_CLOSE = /[›〉⟩❯❭⧽˃ᐳ≫⟫﹥]/g;
const FULL_WIDTH_ASCII = /[！-～]/g;

/** The same text, the same length, with disguised brackets and full-width letters made plain. */
function markupView(text: string): string {
  return text
    .replace(FULL_WIDTH_ASCII, (char) => String.fromCharCode(char.charCodeAt(0) - 0xfee0))
    .replace(LOOKALIKE_OPEN, '<')
    .replace(LOOKALIKE_CLOSE, '>');
}

/** `<` and `>`, also as HTML entities, which a model may decode. */
const LT = '(?:<|&lt;|&#0*60;|&#x0*3c;)';
const GT = '(?:>|&gt;|&#0*62;|&#x0*3e;)';
/**
 * Real attributes only (`x="1"`, `lang=en`, `hidden`). Prose after a cut-off tag ("rows -> cards")
 * isn't attribute-shaped, so it is never taken along with the tag.
 */
const ATTRIBUTES = `(?:\\s+[a-z][\\w-]*(?:\\s*=\\s*(?:"[^"<>]*"|'[^'<>]*'|[^\\s<>"'&]+))?){0,10}\\s*\\/?`;

/**
 * The data block's tag in any case or spacing, with a separator (`portfolio_data`, `portfolio
 * data`, `portfolio-data`), so component names such as `<PortfolioData />` or
 * `<portfolio-data-sync>` are not mistaken for it.
 */
const DATA_TAG_HEAD = `${LT}\\s*\\/?\\s*portfolio[\\s_-]+data(?![\\w-])`;
const DATA_TAG = `${DATA_TAG_HEAD}${ATTRIBUTES}${GT}`;
/** Removal also takes a cut-off head (`</portfolio_data`), with its attributes only if closed. */
const DATA_TAG_OR_HEAD = `${DATA_TAG_HEAD}(?:${ATTRIBUTES}${GT})?`;
const ROLE_TAG = `${LT}\\s*\\/?\\s*(?:system|assistant|developer|instructions?)(?![\\w-])${ATTRIBUTES}${GT}`;
/** `<|im_start|>`, `<|eot_id|>`, `[INST]`, `<<SYS>>`. */
const TEMPLATE_TOKEN = `${LT}\\|[^|<>\\n]{1,40}\\|${GT}|\\[\\/?inst\\]|${LT}${LT}\\/?sys${GT}${GT}`;

const CONTROL = new RegExp(`${TEMPLATE_TOKEN}|${ROLE_TAG}|${DATA_TAG}`, 'i');
const REMOVABLE = new RegExp(`${TEMPLATE_TOKEN}|${ROLE_TAG}|${DATA_TAG_OR_HEAD}`, 'gi');
const DELIMITER = new RegExp(DATA_TAG, 'i');

/** True when `text` contains control markup: a delimiter, template token, or role tag. */
export const containsControlMarkup = (text: string) =>
  CONTROL.test(markupView(text.replace(INVISIBLE, '')));

/** True when `text` contains the data block's delimiter, however disguised. */
export const containsDataDelimiter = (text: string) =>
  DELIMITER.test(markupView(text.replace(INVISIBLE, '')));

/** `text` with the spans `pattern` (global) matches in its view cut out. */
function cutMatches(text: string, pattern: RegExp): string {
  let result = '';
  let kept = 0;
  for (const match of markupView(text).matchAll(pattern)) {
    result += text.slice(kept, match.index);
    kept = match.index + match[0].length;
  }
  return result + text.slice(kept);
}

/**
 * `text` without invisible characters or control markup, repeated until nothing changes, so
 * nested pieces (`</portfolio_</portfolio_data>data>`) can't reassemble a tag.
 */
export function stripControlMarkup(text: string): string {
  let current = text.replace(INVISIBLE, '');
  for (;;) {
    const next = cutMatches(current, REMOVABLE);
    if (next === current) return current;
    current = next;
  }
}
