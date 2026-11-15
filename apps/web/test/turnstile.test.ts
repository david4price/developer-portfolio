import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { CHAT_SESSION_CHALLENGE_ACTION, CHALLENGE_TOKEN_MAX_LENGTH } from '@portfolio/shared-types';
import { mountChallenge, type TurnstileApi, type TurnstileOptions } from '../src/lib/turnstile.js';

function fixture() {
  const tokens: (string | null)[] = [];
  const calls: string[] = [];
  let options: TurnstileOptions | undefined;
  const container = {} as HTMLElement;
  // Like Turnstile when api.js was added dynamically: ready() throws instead of waiting.
  const api: TurnstileApi & { ready(callback: () => void): void } = {
    ready() {
      throw new Error('turnstile.ready() would break if called before api.js is loaded');
    },
    render(element, value) {
      assert.equal(element, container);
      options = value;
      calls.push('render');
      return 'widget-id';
    },
    reset(id) {
      assert.equal(id, 'widget-id');
      calls.push('reset');
    },
    remove(id) {
      assert.equal(id, 'widget-id');
      calls.push('remove');
    },
  };
  const dispose = mountChallenge(api, container, 'public-test-sitekey', {
    token(value) {
      tokens.push(value);
    },
    unavailable() {
      calls.push('unavailable');
    },
  });
  return {
    tokens,
    calls,
    dispose,
    options: () => {
      assert.ok(options);
      return options;
    },
  };
}

describe('Turnstile challenge lifecycle', () => {
  it('binds the server action, omits hidden form data, and forwards only bounded tokens', () => {
    const f = fixture();
    const options = f.options();
    assert.equal(options.action, CHAT_SESSION_CHALLENGE_ACTION);
    assert.equal(options.sitekey, 'public-test-sitekey');
    assert.equal(options['response-field'], false);
    assert.equal(options.size, 'compact');
    options.callback('fresh-token');
    options.callback('');
    options.callback('x'.repeat(CHALLENGE_TOKEN_MAX_LENGTH + 1));
    assert.deepEqual(f.tokens, ['fresh-token', null, null]);
  });

  it('invalidates and resets expired and timed-out challenges', () => {
    const f = fixture();
    f.options().callback('token');
    f.options()['expired-callback']();
    f.options()['timeout-callback']();
    assert.deepEqual(f.tokens, ['token', null, null]);
    assert.deepEqual(f.calls, ['render', 'reset', 'reset']);
  });

  it('fails closed and notifies the UI when verification fails', () => {
    const f = fixture();
    f.options().callback('token');
    f.options()['error-callback']();
    assert.deepEqual(f.tokens, ['token', null]);
    assert.deepEqual(f.calls, ['render', 'unavailable']);
  });

  it('removes consumed widgets and ignores callbacks after unmount', () => {
    const f = fixture();
    f.dispose();
    f.options().callback('stale-token');
    f.options()['expired-callback']();
    f.options()['error-callback']();
    assert.deepEqual(f.tokens, []);
    assert.deepEqual(f.calls, ['render', 'remove']);
  });

  it('renders at once without turnstile.ready(), which rejects a dynamically added api.js', () => {
    const f = fixture();
    assert.deepEqual(f.calls, ['render']);
    assert.equal(f.options().sitekey, 'public-test-sitekey');
  });
});
