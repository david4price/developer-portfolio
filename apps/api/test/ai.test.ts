import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { AiDisabledError } from '../src/modules/ai/ai-provider.js';
import { createAiProvider } from '../src/modules/ai/ai.module.js';
import { OpenAiCompatibleProvider } from '../src/modules/ai/openai-compatible.provider.js';

describe('createAiProvider', () => {
  it('returns the disabled adapter when AI is off', async () => {
    const provider = createAiProvider({ enabled: false });
    assert.equal(provider.enabled, false);
    await assert.rejects(
      provider.complete({ messages: [], maxOutputTokens: 10 }, AbortSignal.timeout(1_000)),
      AiDisabledError,
    );
  });

  it('builds the openai-compatible adapter', () => {
    const provider = createAiProvider({
      enabled: true,
      provider: 'openai-compatible',
      model: 'example-model',
      baseUrl: 'http://inference.internal:8000/v1',
    });
    assert.ok(provider instanceof OpenAiCompatibleProvider);
    assert.equal(provider.enabled, true);
  });

  it('fails startup when openai-compatible has no base URL', () => {
    assert.throws(
      () =>
        createAiProvider({
          enabled: true,
          provider: 'openai-compatible',
          model: 'example-model',
          baseUrl: null,
        }),
      /AI_BASE_URL is required/,
    );
  });

  it('fails loudly for providers without an adapter', () => {
    assert.throws(
      () =>
        createAiProvider({
          enabled: true,
          provider: 'ollama',
          model: 'example-model',
          baseUrl: 'http://ollama:11434',
        }),
      /not implemented yet/,
    );
  });
});
