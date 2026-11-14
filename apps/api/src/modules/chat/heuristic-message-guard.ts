import { DATA_CLOSE, DATA_OPEN, SYSTEM_RULES } from './chat-prompt.js';
import type {
  MessageGuard,
  MessageRejection,
  ReplyRejection,
  ScreenedMessage,
} from './message-guard.js';

/**
 * Characters a visitor can't see but a model reads: format characters (zero-width, bidi
 * overrides, BOM, Unicode tag characters used to smuggle hidden instructions), private-use code
 * points, and control characters other than tab and newline.
 */
const INVISIBLE = /[\p{Cf}\p{Co}]|(?![\t\n])\p{Cc}/gu;

/** Lowercase letters and digits only, words separated by single spaces, accents removed. */
const fold = (text: string) =>
  text
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

/** Letter-spaced text ("i g n o r e  a l l") with the spaces taken out. */
const squeezedRuns = (folded: string) =>
  (folded.match(/\b(?:[a-z0-9] ){5,}[a-z0-9]\b/g) ?? []).map((run) => run.replaceAll(' ', ''));

/** Patterns over the raw (normalized) text, where markup still matters. */
const RAW_RULES: readonly (readonly [MessageRejection, RegExp])[] = [
  // Chat-template control tokens and role tags: <|im_start|>, [INST], <<SYS>>, <system>.
  ['role_injection', /<\|[\w-]{1,30}\|>|\[\/?inst\]|<<\/?sys>>/i],
  ['role_injection', /<\s*\/?\s*(?:system|assistant|developer|instructions?)\b[^>]*>/i],
  // Anything resembling the data block's tag, whatever its case, spacing, or separator.
  ['role_injection', /<\s*\/?\s*portfolio[\s_-]*data\b[^>]*>/i],
  // A line that claims to speak as another role: "System: …", "### Assistant:".
  [
    'role_injection',
    /^[ \t]*(?:#{1,6}[ \t]*)?(?:system|assistant|developer)(?:[ \t]+(?:prompt|message))?[ \t]*:/im,
  ],
  // Long encoded payloads (base64 and similar) the model could be asked to decode and follow.
  ['obfuscation', /[A-Za-z0-9+/]{120,}={0,2}/],
];

const QUALIFIER =
  '(?:previous|prior|above|earlier|preceding|initial|original|system|developer|hidden|all|your|these|those)';
const DIRECTIVE =
  '(?:instructions?|rules?|prompts?|directions?|directives?|guidelines?|constraints?|guardrails?|programming|context)';

/** Patterns over folded text, so case, punctuation, and accents can't hide them. */
const FOLDED_RULES: readonly (readonly [MessageRejection, RegExp])[] = [
  [
    'instruction_override',
    new RegExp(
      // Verbs with everyday technical senses ("override the existing CSS rules", "drop all the
      // constraints") are left out on purpose.
      `\\b(?:ignore|disregard|forget|bypass) (?:(?:all|any|the|of|every) )*` +
        `(?:(?:your|my|these|those|its) )?${QUALIFIER} (?:\\w+ )?${DIRECTIVE}\\b`,
    ),
  ],
  ['instruction_override', /\b(?:you are|you re|youre) no longer\b/],
  ['instruction_override', /\bfrom now on you (?:are|will|must|should|can)\b/],
  // "System", "hidden", and "secret" prompts are rejected however they're asked ("print system
  // prompt", "the assistant's system prompt"), even in a question about a portfolio project's
  // own. "Initial", "original", and "developer" prompts have everyday senses, so only when aimed
  // at this assistant here, or demanded at the start of a clause (`DEMANDED_PROMPT`).
  ['prompt_extraction', /\b(?:system|hidden|secret) prompt\b/],
  [
    'prompt_extraction',
    /\b(?:your|ur|this assistant s|the assistant s) (?:initial|original|developer) prompt\b/,
  ],
  [
    'prompt_extraction',
    /\b(?:reveal|show|print|repeat|output|display|dump|leak|recite|share|tell me|give me|write out|what (?:is|are|were)) (?:me )?(?:\w+ ){0,2}your (?:\w+ )?(?:prompt|instructions)\b/,
  ],
  [
    'prompt_extraction',
    /\b(?:repeat|print|output) (?:everything|all|the text|the words) (?:above|before)\b/,
  ],
  [
    'jailbreak',
    /\b(?:jailbreak|jailbroken|dan mode|developer mode|god mode|do anything now|unfiltered mode|uncensored mode)\b/,
  ],
  [
    'jailbreak',
    /\b(?:act|behave|respond|roleplay|role play) as (?:an? )?(?:\w+ )?(?:unrestricted|unfiltered|uncensored|jailbroken|evil) (?:ai|assistant|model|chatbot|bot)\b/,
  ],
  ['jailbreak', /\bpretend (?:to be|you are|you re|that you are)\b/],
  [
    'jailbreak',
    /\byou (?:have|are under) no (?:restrictions|rules|limits|filters|guidelines|guardrails)\b/,
  ],
];

/**
 * A clause that opens by demanding an initial, original, or developer prompt ("show me the
 * initial prompt", "can you print the original prompt"). A question about what a program does
 * ("does the CLI display its original prompt?") opens differently and passes; wording that slips
 * through still meets the reply check.
 */
const DEMANDED_PROMPT =
  /^(?:(?:please|now|just|ok|okay|so|hi|hey) )*(?:(?:can|could|would|will) you (?:please )?)?(?:print|repeat|reveal|show|output|display|dump|leak|recite|copy|share|write out|give me|tell me)(?: me)? (?:\w+ ){0,3}?(?:initial|original|developer) prompt\b/;

/** Hidden in letter-spaced text, these words are reason enough to reject. */
const SQUEEZED_TRIGGERS = /ignore|disregard|instruction|systemprompt|jailbreak|pretend/;

/**
 * The data block's exact delimiters, echoed back. Retrieved data can't contain them (its markup is
 * neutralized), so only the framing itself produces them; near-misses such as `PortfolioData` or
 * `portfolio-data-sync` are ordinary names, not leaks.
 */
const DELIMITERS = [DATA_OPEN, DATA_CLOSE].map((tag) => tag.toLowerCase());

/** Consecutive words of the system rules that a reply may not repeat. */
const LEAK_SHINGLE_WORDS = 10;

const shingles = (folded: string, size: number): string[] => {
  const words = folded.split(' ');
  const result: string[] = [];
  for (let index = 0; index + size <= words.length; index += 1) {
    result.push(words.slice(index, index + size).join(' '));
  }
  return result;
};

/**
 * Rule-based screening. It catches the common, low-effort injection patterns and anything that
 * hides text from a human reader; it is one layer of several (fixed system rules, data framing,
 * no tools, validated links, quotas), not a guarantee. False positives cost a visitor one
 * rephrased question, so the patterns target instruction-shaped phrasing, not topics.
 */
export class HeuristicMessageGuard implements MessageGuard {
  private readonly ruleShingles = new Set(shingles(fold(SYSTEM_RULES), LEAK_SHINGLE_WORDS));

  screenMessage(raw: string): ScreenedMessage {
    const message = raw
      .normalize('NFKC')
      .replace(/\r\n?/g, '\n')
      .replace(INVISIBLE, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
    if (message === '') return { allowed: false, reason: 'empty' };

    for (const [reason, pattern] of RAW_RULES) {
      if (pattern.test(message)) return { allowed: false, reason };
    }
    const folded = fold(message);
    for (const [reason, pattern] of FOLDED_RULES) {
      if (pattern.test(folded)) return { allowed: false, reason };
    }
    const clauses = message.split(/[.!?;:,\n\u2013\u2014]+|\s-\s/).map(fold);
    if (clauses.some((clause) => DEMANDED_PROMPT.test(clause))) {
      return { allowed: false, reason: 'prompt_extraction' };
    }
    if (squeezedRuns(folded).some((run) => SQUEEZED_TRIGGERS.test(run))) {
      return { allowed: false, reason: 'obfuscation' };
    }
    return { allowed: true, message };
  }

  screenReply(reply: string): ReplyRejection | undefined {
    const lower = reply.toLowerCase();
    if (DELIMITERS.some((tag) => lower.includes(tag))) return 'prompt_leak';
    const leaked = shingles(fold(reply), LEAK_SHINGLE_WORDS).some((shingle) =>
      this.ruleShingles.has(shingle),
    );
    return leaked ? 'prompt_leak' : undefined;
  }
}
