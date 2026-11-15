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

  it('keeps words apart where an emoji sat between them', () => {
    assert.equal(withoutEmoji('dogs🐶cats'), 'dogs cats');
    assert.equal(withoutEmoji('word 🐶cats'), 'word cats');
    assert.equal(withoutEmoji('Great!🐶Next'), 'Great! Next');
    assert.equal(withoutEmoji('See Recipe Finder🐶.'), 'See Recipe Finder.');
    assert.equal(withoutEmoji('word🐶𠮷 and x🐶𝐀bc'), 'word 𠮷 and x 𝐀bc');
    assert.equal(withoutEmoji('dogs🐶 🐾cats'), 'dogs cats');
    assert.equal(withoutEmoji('Great job🐶 🐾Next'), 'Great job Next');
    assert.equal(withoutEmoji('Meet at 10:🐶30'), 'Meet at 10:30');
  });

  it('adds no space after opening brackets, quotes, or Markdown markers', () => {
    assert.equal(
      withoutEmoji('**🐶Bold** and (🐶see) "🐶Hi" [🐶x]'),
      '**Bold** and (see) "Hi" [x]',
    );
  });

  it('leaves no joiner or variation selector behind', () => {
    for (const input of ['A\u200D🐶B', 'dog 🐕\u200D🐾 paws', 'x 🐶\uFE0F\u200D y']) {
      assert.doesNotMatch(withoutEmoji(input), /\u200D|\uFE0F/u, input);
    }
    assert.equal(withoutEmoji('dog 🐕\u200D🐾 paws'), 'dog paws');
    assert.equal(withoutEmoji('A\u200D🐶B'), 'A B');
  });

  it('removes whole sequences: families, skin tones, flags, keycaps, and emoji forms', () => {
    assert.equal(withoutEmoji('Hi 👨\u200D👩\u200D👧 family'), 'Hi family');
    assert.equal(withoutEmoji('A 👍🏽 thumb and a 🇩🇪 flag'), 'A thumb and a flag');
    assert.equal(withoutEmoji('Step 1\uFE0F\u20E3 first'), 'Step first');
    assert.equal(withoutEmoji('Love ❤\uFE0F it ©\uFE0F'), 'Love it');
  });

  it('keeps text symbols that are not displayed as emoji', () => {
    const text = 'Next.js™ © 2026: a ↔ b, a → b, ★ rated, ✔ checked, 10⁶ req/s, <Tag />';
    assert.equal(withoutEmoji(text), text);
  });

  it('returns an empty string for an emoji-only reply', () => {
    assert.equal(withoutEmoji(' 🐶🐾 '), '');
  });
});
