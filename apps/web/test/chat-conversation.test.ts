import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { it } from 'node:test';
import {
  appendChatEntry,
  ChatConversation,
  chatGreeting,
  type ChatEntry,
} from '../src/components/chat-conversation.js';
import { sendsOnEnter } from '../src/lib/chat-keys.js';

const render = (props: Partial<Parameters<typeof ChatConversation>[0]> = {}) =>
  renderToStaticMarkup(
    createElement(ChatConversation, {
      assistantName: 'Rex',
      entries: [],
      renderLink: (link) => createElement('a', { href: link.path }, link.title),
      ...props,
    }),
  );

it('escapes visitor and model markup and never autolinks URLs in their text', () => {
  const html = renderToStaticMarkup(
    createElement(ChatConversation, {
      assistantName: 'Rex',
      renderLink: (link) => createElement('a', { href: link.path }, link.title),
      entries: [
        {
          id: 0,
          question: '<img src=x onerror=alert(1)>',
          answer: {
            reply: '<script>alert(1)</script> https://evil.example.com/',
            links: [
              {
                kind: 'project',
                slug: 'example',
                title: 'A <project>',
                path: '/projects/example/',
              },
            ],
          },
        },
      ],
    }),
  );
  assert.ok(!html.includes('<script>'));
  assert.ok(!html.includes('<img'));
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(html.includes('&lt;img'));
  assert.ok(!html.includes('href="https://evil.example.com/"'));
  assert.ok(html.includes('href="/projects/example/"'));
  assert.ok(html.includes('A &lt;project&gt;'));
  assert.match(html, /role="log"/);
  // The visitor's bubble on the right, then the assistant's on the left; names only for screen readers.
  assert.match(
    html,
    /chat-message--user.*<span class="visually-hidden">You: <\/span>.*chat-message--assistant[^>]*data-reply.*<span class="visually-hidden">Rex: <\/span>/s,
  );
  assert.match(html, /<ul class="chat-links" aria-label="Suggested pages">/);
});

it('keeps stable exchange identities when the history limit removes old replies', () => {
  const exchanges: ChatEntry[] = Array.from({ length: 25 }, (_, id) => ({
    id,
    question: 'Tell me more',
    answer: { reply: 'Another reply', links: [] },
  }));
  let entries: readonly ChatEntry[] = [];
  for (const exchange of exchanges) entries = appendChatEntry(entries, exchange);
  assert.equal(entries.length, 20);
  assert.deepEqual(
    entries.map((entry) => entry.id),
    Array.from({ length: 20 }, (_, i) => i + 5),
  );
  for (const entry of entries) assert.equal(entry, exchanges[entry.id]);
});

it('greets first once a chat has started, as the assistant, without a model call', () => {
  assert.ok(chatGreeting('Rex').startsWith("Hi, I'm Rex! I'll be your guide"));
  // As rendered: React escapes the apostrophes.
  const greeting = chatGreeting('Rex').replaceAll("'", '&#x27;');
  assert.ok(!render().includes(greeting), 'no greeting before the chat starts');
  const html = render({
    greeting: true,
    entries: [{ id: 0, question: 'Q', answer: { reply: 'A', links: [] } }],
  });
  const at = html.indexOf(greeting);
  assert.ok(at > 0 && at < html.indexOf('Q</p>'), 'the greeting comes first');
  const before = html.slice(0, at);
  assert.ok(before.includes('chat-message--assistant'), 'it is the assistant speaking');
  assert.ok(!before.includes('data-reply'), 'the greeting is not a reply');
});

it('shows a waiting question at once, with a typing indicator hidden from screen readers', () => {
  const html = render({ pending: 'Is it <b>live</b>?' });
  assert.match(html, /chat-message--user.*Is it &lt;b&gt;live&lt;\/b&gt;\?/s);
  assert.match(
    html,
    /chat-message--assistant" aria-hidden="true"><p class="chat-bubble chat-typing">/,
  );
  assert.ok(!html.includes('data-reply'), 'no reply yet');
  assert.ok(!render().includes('chat-typing'), 'no indicator when nothing is waiting');
});

it('sends on Enter only with a fine pointer, and never on Shift+Enter or while composing', () => {
  const press = (key: string, shiftKey = false, isComposing = false) => ({
    key,
    shiftKey,
    isComposing,
  });
  assert.equal(sendsOnEnter(press('Enter'), true), true);
  assert.equal(sendsOnEnter(press('Enter', true), true), false);
  assert.equal(sendsOnEnter(press('Enter', false, true), true), false);
  assert.equal(sendsOnEnter(press('Enter'), false), false, 'touch keyboards add a new line');
  assert.equal(sendsOnEnter(press('a'), true), false);
});
