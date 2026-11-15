import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import {
  CLASSIFIER_FILES,
  OnnxInjectionClassifier,
} from '../src/modules/chat/onnx-injection-classifier.js';

/**
 * The model directory checks that run before any model is created, on fake files. The real model
 * is exercised by `test:guard-eval`.
 */
describe('OnnxInjectionClassifier.load', () => {
  let directory: string;
  const write = (file: string, value: unknown) =>
    writeFile(join(directory, file), typeof value === 'string' ? value : JSON.stringify(value));

  before(async () => {
    directory = await mkdtemp(join(tmpdir(), 'classifier-'));
    await write(CLASSIFIER_FILES.model, 'not a model');
    await write(CLASSIFIER_FILES.tokenizerConfig, {});
  });
  after(() => rm(directory, { recursive: true, force: true }));

  const loadWith = async (config: unknown, tokenizer: unknown) => {
    await write(CLASSIFIER_FILES.config, config);
    await write(CLASSIFIER_FILES.tokenizer, tokenizer);
    return OnnxInjectionClassifier.load(directory);
  };

  it('rejects a queue limit that is not a non-negative integer', async () => {
    for (const maxQueued of [Number.NaN, -1, 1.5]) {
      await assert.rejects(OnnxInjectionClassifier.load(directory, { maxQueued }), RangeError);
    }
  });

  it('rejects a window too small to hold any text', async () => {
    await assert.rejects(OnnxInjectionClassifier.load(directory, { windowTokens: 2 }), RangeError);
    await assert.rejects(
      OnnxInjectionClassifier.load(directory, { windowTokens: 64.5 }),
      RangeError,
    );
  });

  it('rejects a model without an INJECTION label', async () => {
    await assert.rejects(loadWith({}, {}), /id2label/);
    await assert.rejects(loadWith({ id2label: { 0: 'SAFE', 1: 'UNSAFE' } }, {}), /INJECTION/);
  });

  it('rejects a tokenizer that truncates, since text past the limit would never be scored', async () => {
    await assert.rejects(
      loadWith({ id2label: { 0: 'BENIGN', 1: 'INJECTION' } }, { truncation: { max_length: 512 } }),
      /must not truncate/,
    );
  });

  it('rejects a missing model directory', async () => {
    await assert.rejects(OnnxInjectionClassifier.load(join(directory, 'missing')), {
      code: 'ENOENT',
    });
  });
});
