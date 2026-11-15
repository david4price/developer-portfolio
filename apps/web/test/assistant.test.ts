import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { DEFAULT_ASSISTANT_NAME } from '@portfolio/shared-types';
import { assistantNameFrom } from '../src/lib/assistant.js';

describe('assistantNameFrom', () => {
  it('uses the default when the build setting is unset or empty', () => {
    assert.equal(assistantNameFrom(undefined), DEFAULT_ASSISTANT_NAME);
    assert.equal(assistantNameFrom('  '), DEFAULT_ASSISTANT_NAME);
  });

  it('accepts a plain name, trimmed', () => {
    assert.equal(assistantNameFrom(' Rex '), 'Rex');
    assert.equal(assistantNameFrom("Mary-Jo O'Dog"), "Mary-Jo O'Dog");
    assert.equal(assistantNameFrom('N\u0303andu\u0301'), 'Ñandú');
  });

  it('fails the build for anything the API would reject, without echoing it', () => {
    for (const value of ['<b>Rex</b>', 'R2D2', 'a'.repeat(31)]) {
      assert.throws(
        () => assistantNameFrom(value),
        (error: unknown) =>
          error instanceof Error &&
          error.message.includes('NEXT_PUBLIC_ASSISTANT_NAME') &&
          !error.message.includes(value),
        value,
      );
    }
  });
});
