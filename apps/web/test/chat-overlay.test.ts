import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, it } from 'node:test';
import { ChatOverlay, openChatDialog, outsideDialog } from '../src/components/chat-overlay.js';

describe('floating chat overlay', () => {
  it('starts closed, exposes an accessible artwork button, and contains no verification frame', () => {
    const html = renderToStaticMarkup(
      createElement(ChatOverlay, { assistantName: 'Rex', open: false, onOpen() {}, onClose() {} }),
    );
    assert.match(html, /aria-label="Open portfolio chat"/);
    assert.match(html, /aria-haspopup="dialog"/);
    assert.match(html, /aria-expanded="false"/);
    assert.match(html, /data-pose="lying"/);
    assert.ok(!html.includes('chat-dog__pose--sitting'));
    assert.ok(!html.includes('chat-dog__pose--standing'));
    assert.match(html, /<dialog[^>]*aria-labelledby=/);
    assert.match(html, /aria-label="Close portfolio chat"/);
    assert.ok(!/<dialog[^>]*\sopen(?:\s|=|>)/.test(html));
    assert.ok(!html.includes('<iframe'));
    assert.ok(!html.includes('challenges.cloudflare.com'));
  });

  it('keeps the active poses mounted after first activation for subsequent replies and reopening', () => {
    const html = renderToStaticMarkup(
      createElement(ChatOverlay, {
        assistantName: 'Rex',
        open: false,
        loaded: true,
        onOpen() {},
        onClose() {},
      }),
    );
    assert.match(html, /chat-dog__pose--sitting/);
    assert.match(html, /chat-dog__pose--standing/);
  });

  it('sits in the speech bubble dialog, stands while waiting, then sits again', () => {
    for (const waiting of [false, true, false]) {
      const html = renderToStaticMarkup(
        createElement(ChatOverlay, {
          assistantName: 'Rex',
          open: true,
          waiting,
          onOpen() {},
          onClose() {},
        }),
      );
      const dialog = html.slice(html.indexOf('<dialog'));
      assert.match(html, /aria-expanded="true"/);
      assert.match(dialog, /class="chat-popup__bubble"/);
      assert.match(dialog, new RegExp(`data-pose="${waiting ? 'standing' : 'sitting'}"`));
      assert.ok(!dialog.includes('data-pose="lying"'));
      assert.match(dialog, /class="chat-popup__dog"[^>]*aria-label="Close portfolio chat"/);
      assert.match(dialog, /<h2 id="[^"]+-title">Chat with Rex<\/h2>/);
    }
  });

  it('returns to the resting launcher when closed during an outstanding request', () => {
    const html = renderToStaticMarkup(
      createElement(ChatOverlay, {
        assistantName: 'Rex',
        open: false,
        waiting: true,
        onOpen() {},
        onClose() {},
      }),
    );
    const launcher = html.slice(0, html.indexOf('<dialog'));
    assert.match(launcher, /aria-expanded="false"/);
    assert.match(launcher, /data-pose="lying"/);
    assert.ok(!/<dialog[^>]*\sopen(?:\s|=|>)/.test(html));
  });

  it('uses the native modal top layer and restores launcher focus when closed', () => {
    const calls: string[] = [];
    const dialog = {
      open: false,
      showModal() {
        this.open = true;
        calls.push('showModal');
      },
      close() {
        this.open = false;
        calls.push('close');
      },
    };
    const dispose = openChatDialog(dialog, {
      focus() {
        calls.push('focus');
      },
    });
    assert.equal(dialog.open, true);
    dispose();
    assert.equal(dialog.open, false);
    assert.deepEqual(calls, ['showModal', 'close', 'focus']);
  });

  it('restores focus after native Escape dismissal without trying to close twice', () => {
    const calls: string[] = [];
    const dialog = {
      open: true,
      showModal() {
        calls.push('showModal');
      },
      close() {
        calls.push('close');
      },
    };
    const dispose = openChatDialog(dialog, {
      focus() {
        calls.push('focus');
      },
    });
    dialog.open = false;
    dispose();
    assert.deepEqual(calls, ['focus']);
  });

  it('dismisses only backdrop clicks, including on each side of the panel', () => {
    const bounds = { left: 20, right: 400, top: 40, bottom: 600 };
    for (const [clientX, clientY] of [
      [19, 100],
      [401, 100],
      [50, 39],
      [50, 601],
    ]) {
      assert.equal(outsideDialog({ clientX: clientX ?? 0, clientY: clientY ?? 0 }, bounds), true);
    }
    for (const [clientX, clientY] of [
      [20, 40],
      [400, 600],
      [100, 100],
    ]) {
      assert.equal(outsideDialog({ clientX: clientX ?? 0, clientY: clientY ?? 0 }, bounds), false);
    }
  });
});
