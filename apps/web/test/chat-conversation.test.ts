import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { it } from 'node:test';
import {
  appendChatEntry,
  ChatConversation,
  type ChatEntry,
} from '../src/components/chat-conversation.js';

it('escapes visitor and model markup and never autolinks URLs in their text', () => {
  const html = renderToStaticMarkup(
    createElement(ChatConversation, {
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
