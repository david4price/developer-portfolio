import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { withoutEmoji } from '../src/modules/chat/reply-emoji.js';

describe('withoutEmoji', () => {
  it('removes emoji and the space they leave, wherever they sit', () => {
    const cases: [string, string][] = [
      ['You might ask the developer directly. 🐶', 'You might ask the developer directly.'],
      ['Yes. 🐕🐾', 'Yes.'],
      ['🐶 Hello there', 'Hello there'],
      ['Proud 🐶 of it', 'Proud of it'],
      ['Done 🐾  \nNext line', 'Done\nNext line'],
      ['- ✅ done\n  - 🐾 nested', '- done\n  - nested'],
    ];
    for (const [input, expected] of cases) assert.equal(withoutEmoji(input), expected, input);
  });

  it('removes whole sequences: families, skin tones, flags, keycaps, and emoji forms', () => {
    assert.equal(withoutEmoji('Hi 👨‍👩‍👧 family'), 'Hi family');
    assert.equal(withoutEmoji('A 👍🏽 thumb and a 🇩🇪 flag'), 'A thumb and a flag');
    assert.equal(withoutEmoji('Step 1️⃣ first'), 'Step first');
    assert.equal(withoutEmoji('Love ❤️ it ©️'), 'Love it');
  });

  it('keeps text symbols that are not displayed as emoji', () => {
    const text = 'Next.js™ © 2026: a ↔ b, a → b, ★ rated, ✔ checked, 10⁶ req/s, <Tag />';
    assert.equal(withoutEmoji(text), text);
  });

  it('returns an empty string for an emoji-only reply', () => {
    assert.equal(withoutEmoji(' 🐶🐾 '), '');
  });
});
