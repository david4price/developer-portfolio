import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { AiDisabledError } from '../src/modules/ai/ai-provider.js';
import { createAiProvider } from '../src/modules/ai/ai.module.js';

describe('createAiProvider', () => {
  it('returns the disabled adapter when AI is off', async () => {
    const provider = createAiProvider({ enabled: false });
    assert.equal(provider.enabled, false);
    await assert.rejects(
      provider.complete({ messages: [], maxOutputTokens: 10 }, AbortSignal.timeout(1_000)),
      AiDisabledError,
    );
  });

  it('fails loudly for providers without an adapter', () => {
    assert.throws(
      () =>
        createAiProvider({
          enabled: true,
          provider: 'openai-compatible',
          model: 'example-model',
          baseUrl: null,
        }),
      /not implemented yet/,
    );
  });
});
