import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Tokenizer } from '@huggingface/tokenizers';
import * as ort from 'onnxruntime-node';
import { InjectionClassifierBusyError, type InjectionClassifier } from './injection-classifier.js';

/** Files a model directory must hold (see `scripts/fetch-injection-classifier.mjs`). */
export const CLASSIFIER_FILES = {
  model: 'model.onnx',
  config: 'config.json',
  tokenizer: 'tokenizer.json',
  tokenizerConfig: 'tokenizer_config.json',
} as const;

export interface OnnxInjectionClassifierOptions {
  /**
   * Tokens per window, special tokens included; longer messages are scored window by window.
   * Attention cost grows faster than length (about 6 ms for 16 tokens, 0.25 s for 512, 4 s for
   * 2,048 on the reference CPU), so windows stay small and a long message costs a few of them.
   */
  readonly windowTokens?: number;
  /** Messages allowed to wait behind the one being scored; more are refused at once. */
  readonly maxQueued?: number;
}

const INPUT_IDS = 'input_ids';
const ATTENTION_MASK = 'attention_mask';
const INJECTION_LABEL = 'INJECTION';

/**
 * A sequence-classification model (BENIGN/INJECTION logits) run on the CPU through ONNX Runtime's
 * native Node binding (glibc). `run` executes on the libuv thread pool, so scoring never blocks
 * the event loop: health checks and other requests keep moving during a long message. One
 * thread, one inference at a time: a typical message takes a few milliseconds, and serializing
 * them keeps CPU and memory flat under a burst instead of multiplying them.
 */
export class OnnxInjectionClassifier implements InjectionClassifier {
  private queued = 0;
  private tail: Promise<unknown> = Promise.resolve();
  private disposal: Promise<void> | undefined;

  private constructor(
    private readonly session: ort.InferenceSession,
    private readonly tokenizer: Tokenizer,
    private readonly injectionIndex: number,
    private readonly bos: number,
    private readonly eos: number,
    private readonly windowTokens: number,
    private readonly maxQueued: number,
  ) {}

  /** Loads and checks a model directory. Fails loudly: a guard that can't load must not start. */
  static async load(
    directory: string,
    { windowTokens = 512, maxQueued = 8 }: OnnxInjectionClassifierOptions = {},
  ): Promise<OnnxInjectionClassifier> {
    if (!Number.isInteger(windowTokens) || windowTokens < 16) {
      throw new RangeError('windowTokens must be an integer of at least 16');
    }
    if (!Number.isInteger(maxQueued) || maxQueued < 0) {
      throw new RangeError('maxQueued must be a non-negative integer');
    }
    const json = async (file: string): Promise<unknown> =>
      JSON.parse(await readFile(join(directory, file), 'utf8'));
    const [config, tokenizerJson, tokenizerConfig, model] = await Promise.all([
      json(CLASSIFIER_FILES.config),
      json(CLASSIFIER_FILES.tokenizer),
      json(CLASSIFIER_FILES.tokenizerConfig),
      readFile(join(directory, CLASSIFIER_FILES.model)),
    ]);

    const injectionIndex = injectionIndexOf(config);
    // Windowing needs every token: a tokenizer that truncates would hide the rest of a message.
    if ((tokenizerJson as { truncation?: unknown }).truncation != null) {
      throw new Error('classifier tokenizer must not truncate');
    }
    const tokenizer = new Tokenizer(tokenizerJson as object, tokenizerConfig as object);
    // Windowing re-wraps each chunk the way the tokenizer wraps a whole message.
    const wrapper = tokenizer.encode('').ids;
    const [bos, eos] = wrapper;
    if (wrapper.length !== 2 || bos === undefined || eos === undefined) {
      throw new Error('classifier tokenizer must wrap text in exactly one start and end token');
    }

    const session = await ort.InferenceSession.create(model, {
      executionProviders: ['cpu'],
      graphOptimizationLevel: 'all',
      intraOpNumThreads: 1,
      interOpNumThreads: 1,
    });
    const inputs = [...session.inputNames].sort();
    if (inputs.join() !== [ATTENTION_MASK, INPUT_IDS].join() || session.outputNames.length !== 1) {
      throw new Error(`unsupported classifier signature: ${inputs.join(', ')}`);
    }
    return new OnnxInjectionClassifier(
      session,
      tokenizer,
      injectionIndex,
      bos,
      eos,
      windowTokens,
      maxQueued,
    );
  }

  score(text: string, signal?: AbortSignal, onStart?: () => void): Promise<number> {
    if (this.disposal) return Promise.reject(new Error('injection classifier is disposed'));
    if (signal?.aborted) return Promise.reject(signal.reason);
    if (this.queued > this.maxQueued) return Promise.reject(new InjectionClassifierBusyError());

    // A message holds its queue place until it settles or its caller gives up, whichever is first.
    this.queued++;
    let holding = true;
    const leave = () => {
      if (holding) this.queued--;
      holding = false;
    };
    signal?.addEventListener('abort', leave, { once: true });
    const run = this.tail.then(() => this.scoreNow(text, signal, onStart));
    this.tail = run.catch(() => undefined);
    return run.finally(() => {
      signal?.removeEventListener('abort', leave);
      leave();
    });
  }

  /** Idempotent. `score` refuses new work from the first call, so the queue only drains. */
  dispose(): Promise<void> {
    this.disposal ??= this.tail.then(() => this.session.release());
    return this.disposal;
  }

  /**
   * The highest score over the message's windows. Nothing is cut off, and windows overlap by a
   * quarter (127 tokens by default), so a phrase up to that long that spans a boundary is whole in
   * one of them. Stops between windows once the caller gives up.
   */
  private async scoreNow(
    text: string,
    signal?: AbortSignal,
    onStart?: () => void,
  ): Promise<number> {
    signal?.throwIfAborted();
    onStart?.();
    const content = this.tokenizer.encode(text).ids.slice(1, -1);
    const size = this.windowTokens - 2;
    const stride = size - Math.floor(size / 4);
    let highest = 0;
    for (let start = 0; ; start += stride) {
      signal?.throwIfAborted();
      const window = [this.bos, ...content.slice(start, start + size), this.eos];
      highest = Math.max(highest, await this.scoreWindow(window));
      if (start + size >= content.length) return highest;
    }
  }

  private async scoreWindow(ids: readonly number[]): Promise<number> {
    const tensor = (values: Iterable<number>) =>
      new ort.Tensor('int64', BigInt64Array.from(values, BigInt), [1, ids.length]);
    const outputs = await this.session.run({
      [INPUT_IDS]: tensor(ids),
      [ATTENTION_MASK]: tensor(ids.map(() => 1)),
    });
    const logits = outputs[this.session.outputNames[0] ?? '']?.data;
    if (!(logits instanceof Float32Array) || logits.length < 2) {
      throw new Error('classifier returned no logits');
    }
    return softmax(logits)[this.injectionIndex] ?? 0;
  }
}

function injectionIndexOf(config: unknown): number {
  const labels =
    typeof config === 'object' && config !== null && 'id2label' in config
      ? (config as { id2label: unknown }).id2label
      : undefined;
  if (typeof labels !== 'object' || labels === null) {
    throw new Error('classifier config has no id2label');
  }
  const entry = Object.entries(labels).find(([, label]) => label === INJECTION_LABEL);
  if (entry === undefined || !/^\d+$/.test(entry[0])) {
    throw new Error(`classifier config has no ${INJECTION_LABEL} label`);
  }
  return Number(entry[0]);
}

function softmax(logits: Float32Array): number[] {
  const max = Math.max(...logits);
  const exps = Array.from(logits, (logit) => Math.exp(logit - max));
  const sum = exps.reduce((total, value) => total + value, 0);
  return exps.map((value) => value / sum);
}
