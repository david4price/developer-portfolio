import assert from 'node:assert/strict';
import { docNotes, docNoteUrl, registry } from '@portfolio/project-registry';
import { afterEach, describe, it, mock } from 'node:test';
import { ChatRequestError, createChatSession, sendChatMessage } from '../src/lib/chat.js';

const signal = () => new AbortController().signal;
afterEach(() => mock.restoreAll());

describe('chat browser requests', () => {
  it('sends a fresh challenge with cookie credentials and a bounded, abortable request', async () => {
    const caller = new AbortController();
    let requestSignal: AbortSignal | undefined;
    mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => {
      assert.equal(url, 'https://api.example.com/api/v1/chat/sessions');
      assert.equal(init.credentials, 'include');
      assert.equal(init.redirect, 'error');
      assert.equal(init.method, 'POST');
      assert.deepEqual(JSON.parse(String(init.body)), { turnstileToken: 'fresh-test-token' });
      requestSignal = init.signal ?? undefined;
      return Response.json({ expiresAt: '2026-12-01T00:00:00.000Z' });
    });
    assert.equal(
      (
        await createChatSession(
          'https://api.example.com/api/v1/chat/sessions',
          'fresh-test-token',
          caller.signal,
        )
      ).expiresAt,
      '2026-12-01T00:00:00.000Z',
    );
    caller.abort();
    assert.equal(requestSignal?.aborted, true);
  });

  it('renders replies as data and builds links from this build’s registry, never the response', async () => {
    const project = registry.projects[0];
    const app = registry.miniApps[0];
    assert.ok(project && app);
    const path = `/projects/${project.slug}/`;
    const reply = async (links: unknown[]) => {
      mock.method(globalThis, 'fetch', async (_url: string, init: RequestInit) => {
        assert.deepEqual(JSON.parse(String(init.body)), { message: 'Tell me about the projects' });
        return Response.json({ reply: '<script>untrusted</script>', links });
      });
      const response = await sendChatMessage(
        'https://api.example.com/api/v1/chat/messages',
        'Tell me about the projects',
        signal(),
      );
      assert.equal(response.reply, '<script>untrusted</script>');
      return response.links;
    };

    for (const untrusted of [
      'https://evil.example.com/',
      '//evil.example.com/',
      'javascript:alert(1)',
      '/projects/old/',
    ]) {
      assert.deepEqual(
        await reply([{ kind: 'project', slug: project.slug, path: untrusted, title: 'untrusted' }]),
        [{ kind: 'project', slug: project.slug, title: project.title, path }],
        untrusted,
      );
    }
    assert.deepEqual(
      await reply([{ kind: 'mini-app', slug: app.slug, path: 'https://evil.example.com/' }]),
      [{ kind: 'mini-app', slug: app.slug, title: app.title, path: `/apps/${app.slug}/` }],
    );
    assert.deepEqual(
      await reply([
        { kind: 'project', slug: 'missing', path: '/projects/missing/' },
        { kind: 'javascript', slug: project.slug, path },
        { kind: 'project', slug: project.slug, path },
        { kind: 'project', slug: project.slug, path },
        null,
      ]),
      [{ kind: 'project', slug: project.slug, title: project.title, path }],
      'unknown slugs and kinds are dropped, and repeats of one page too',
    );
  });

  it('builds site page links (About, Experience) from this build’s list, never the response', async () => {
    mock.method(globalThis, 'fetch', async () =>
      Response.json({
        reply: 'My human works in aviation software.',
        links: [
          { kind: 'page', slug: 'experience', path: 'https://evil.example.com/', title: 'x' },
          { kind: 'page', slug: 'about', path: '/about/' },
          { kind: 'page', slug: 'admin', path: '/admin/' },
          { kind: 'page', slug: 'about', path: '/about/' },
        ],
      }),
    );
    const response = await sendChatMessage(
      'https://api.example.com/api/v1/chat/messages',
      'Where does he work?',
      signal(),
    );
    assert.deepEqual(response.links, [
      { kind: 'page', slug: 'experience', title: 'Experience', path: '/experience/' },
      { kind: 'page', slug: 'about', title: 'About', path: '/about/' },
    ]);
  });

  it('builds doc links from this build’s notes by slug, never from the API’s URL', async () => {
    const note = docNotes.notes[0];
    assert.ok(note);
    const url = docNoteUrl(note);
    assert.match(url, /^https:\/\/github\.com\//);
    mock.method(globalThis, 'fetch', async () =>
      Response.json({
        reply: 'How it works.',
        links: [
          { kind: 'doc', slug: note.slug, path: 'https://evil.example.com/', title: 'untrusted' },
          { kind: 'doc', slug: note.slug, path: url },
          { kind: 'doc', slug: note.slug, path: `${url}?x=1` },
          { kind: 'doc', slug: 'missing', path: url },
          { kind: 'project', slug: note.slug, path: url },
        ],
      }),
    );
    const response = await sendChatMessage(
      'https://api.example.com/api/v1/chat/messages',
      'How does it work?',
      signal(),
    );
    assert.deepEqual(
      response.links,
      [{ kind: 'doc', slug: note.slug, title: note.title, path: url }],
      'the API’s URL and title are replaced, and repeats of one note are dropped',
    );
  });

  for (const code of [
    'ai_disabled',
    'challenge_failed',
    'challenge_unavailable',
    'chat_session_required',
    'chat_busy',
    'message_rejected',
    'message_too_long',
    'rate_limited',
    'ai_overloaded',
    'internal_error',
  ]) {
    it(`shows a safe, actionable error for ${code}`, async () => {
      mock.method(globalThis, 'fetch', async () =>
        Response.json({ error: { code, message: 'PRIVATE upstream error' } }, { status: 503 }),
      );
      await assert.rejects(
        createChatSession('https://api.example.com/api/v1/chat/sessions', 'token', signal()),
        (error: unknown) => {
          assert.ok(error instanceof ChatRequestError);
          assert.equal(error.code, code);
          assert.ok(!error.message.includes('PRIVATE'));
          return true;
        },
      );
    });
  }

  for (const body of [{}, { expiresAt: 'invalid' }, { expiresAt: 123 }]) {
    it(`rejects malformed session data ${JSON.stringify(body)}`, async () => {
      mock.method(globalThis, 'fetch', async () => Response.json(body));
      await assert.rejects(
        createChatSession('https://api.example.com/api/v1/chat/sessions', 'token', signal()),
        ChatRequestError,
      );
    });
  }

  it('handles malformed replies, offline failures, and non-JSON errors without upstream text', async () => {
    for (const response of [
      Response.json({ reply: 123, links: [] }),
      Response.json({ reply: 'hi' }),
      new Response('PRIVATE error', { status: 502 }),
    ]) {
      mock.method(globalThis, 'fetch', async () => response);
      await assert.rejects(
        sendChatMessage('https://api.example.com/api/v1/chat/messages', 'hi', signal()),
        ChatRequestError,
      );
      mock.restoreAll();
    }
    mock.method(globalThis, 'fetch', async () => {
      throw new Error('PRIVATE network failure');
    });
    await assert.rejects(
      sendChatMessage('https://api.example.com/api/v1/chat/messages', 'hi', signal()),
      { message: 'Chat is unavailable. Please try again shortly.' },
    );
  });
});
