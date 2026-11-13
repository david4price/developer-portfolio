import assert from 'node:assert/strict';
import { after, beforeEach, describe, it } from 'node:test';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { ApiErrorResponse, ChatMessageResponse } from '@portfolio/shared-types';
import {
  AI_PROVIDER,
  type AiCompletion,
  type AiCompletionRequest,
  AiOverloadedError,
  type AiProvider,
  AiUnavailableError,
} from '../src/modules/ai/ai-provider.js';
import {
  CHAT_SESSION_STORE,
  type ChatSession,
  type ChatSessionStore,
} from '../src/modules/chat/chat-session.store.js';
import { sessionIdFromCookieHeader } from '../src/modules/chat/chat-cookie.js';
import { ChatController } from '../src/modules/chat/chat.controller.js';
import { ChatService, promptHistory } from '../src/modules/chat/chat.service.js';
import { createTestApp } from './support/test-app.js';

/** Same semantics as the Redis adapter: NX locks owned by a token, history kept without resurrection. */
class InMemoryChatStore implements ChatSessionStore {
  readonly sessions = new Map<string, ChatSession>();
  readonly locks = new Map<string, string>();

  async create(sessionId: string, ttlSeconds: number): Promise<ChatSession> {
    const session = {
      expiresAt: new Date(Date.now() + ttlSeconds * 1_000).toISOString(),
      history: [],
    };
    this.sessions.set(sessionId, session);
    return session;
  }
  async load(sessionId: string): Promise<ChatSession | undefined> {
    return this.sessions.get(sessionId);
  }
  async saveHistory(sessionId: string, session: ChatSession): Promise<void> {
    if (this.sessions.has(sessionId)) this.sessions.set(sessionId, session);
  }
  async acquireLock(sessionId: string, token: string): Promise<boolean> {
    if (this.locks.has(sessionId)) return false;
    this.locks.set(sessionId, token);
    return true;
  }
  async releaseLock(sessionId: string, token: string): Promise<void> {
    if (this.locks.get(sessionId) === token) this.locks.delete(sessionId);
  }
}

/** Records requests; replies immediately unless the test holds it with `hold()`. */
class FakeAi implements AiProvider {
  enabled = true;
  readonly requests: AiCompletionRequest[] = [];
  failWith: Error | undefined;
  private gate: Promise<void> | undefined;
  private openGate: (() => void) | undefined;

  hold(): void {
    this.gate = new Promise((resolve) => {
      this.openGate = resolve;
    });
  }
  release(): void {
    this.openGate?.();
    this.gate = undefined;
  }

  async complete(request: AiCompletionRequest): Promise<AiCompletion> {
    this.requests.push(request);
    if (this.gate) await this.gate;
    if (this.failWith) throw this.failWith;
    const last = request.messages.at(-1)?.content ?? '';
    return { content: `  echo: ${last}  `, outputTokens: 3 };
  }
}

describe('chat sessions and messages', () => {
  let app: NestFastifyApplication;
  let store: InMemoryChatStore;
  let ai: FakeAi;

  beforeEach(async () => {
    await app?.close();
    store = new InMemoryChatStore();
    ai = new FakeAi();
    app = await createTestApp({
      controllers: [ChatController],
      providers: [
        ChatService,
        { provide: CHAT_SESSION_STORE, useValue: store },
        { provide: AI_PROVIDER, useValue: ai },
      ],
    });
  });

  after(async () => {
    await app?.close();
  });

  async function startSession(): Promise<string> {
    const response = await app.inject({ method: 'POST', url: '/api/v1/chat/sessions' });
    assert.equal(response.statusCode, 201);
    const setCookie = response.headers['set-cookie'];
    const cookie = String(Array.isArray(setCookie) ? setCookie[0] : setCookie).split(';')[0] ?? '';
    return cookie;
  }

  const send = (cookie: string | undefined, message: unknown) =>
    app.inject({
      method: 'POST',
      url: '/api/v1/chat/messages',
      headers: cookie ? { cookie } : {},
      payload: { message },
    });

  it('creates a session as a secure, HttpOnly cookie scoped to the chat routes', async () => {
    const response = await app.inject({ method: 'POST', url: '/api/v1/chat/sessions' });
    assert.equal(response.statusCode, 201);

    const cookie = String(response.headers['set-cookie']);
    assert.match(cookie, /^portfolio_chat=[A-Za-z0-9_-]{43}; /);
    for (const flag of [
      'Path=/api/v1/chat',
      'Max-Age=86400',
      'HttpOnly',
      'Secure',
      'SameSite=Lax',
    ]) {
      assert.ok(cookie.includes(flag), `cookie lacks ${flag}`);
    }

    const body = response.json<{ expiresAt: string }>();
    assert.deepEqual(Object.keys(body), ['expiresAt']);
    const sessionId = sessionIdFromCookieHeader(cookie.split(';')[0]);
    assert.ok(sessionId && store.sessions.has(sessionId));
    assert.ok(!response.body.includes(sessionId), 'the session ID must not appear in the body');
  });

  it('issues a different 256-bit ID for every session', async () => {
    const ids = new Set<string>();
    for (let index = 0; index < 20; index += 1) ids.add(await startSession());
    assert.equal(ids.size, 20);
  });

  it('answers a message, stores the exchange, and sends history on the next turn', async () => {
    const cookie = await startSession();

    const first = await send(cookie, '  Which projects use Kubernetes?  ');
    assert.equal(first.statusCode, 200);
    assert.deepEqual(first.json<ChatMessageResponse>(), {
      reply: 'echo: Which projects use Kubernetes?',
    });

    await send(cookie, 'And the API?');
    const second = ai.requests[1];
    assert.ok(second);
    assert.equal(second.maxOutputTokens, 400);
    assert.equal(second.messages[0]?.role, 'system');
    assert.deepEqual(second.messages.slice(1), [
      { role: 'user', content: 'Which projects use Kubernetes?' },
      { role: 'assistant', content: 'echo: Which projects use Kubernetes?' },
      { role: 'user', content: 'And the API?' },
    ]);
  });

  it('keeps sessions isolated: one visitor never sees another visitor’s history', async () => {
    const alice = await startSession();
    const bob = await startSession();

    await send(alice, 'secret question from alice');
    await send(bob, 'hello from bob');

    const bobRequest = ai.requests[1];
    assert.ok(bobRequest);
    assert.ok(
      !JSON.stringify(bobRequest.messages).includes('alice'),
      "Bob's prompt must not contain Alice's turns",
    );
    assert.equal(bobRequest.messages.length, 2);
  });

  it('allows one in-flight message per session: a concurrent one gets 409 chat_busy', async () => {
    const cookie = await startSession();
    ai.hold();

    const first = send(cookie, 'first');
    // Let the first request reach the model before sending the second.
    while (ai.requests.length === 0) await new Promise((resolve) => setImmediate(resolve));
    const second = await send(cookie, 'second');

    assert.equal(second.statusCode, 409);
    assert.equal(second.json<ApiErrorResponse>().error.code, 'chat_busy');

    ai.release();
    assert.equal((await first).statusCode, 200);
    assert.equal(ai.requests.length, 1, 'the rejected message must not reach the model');

    // The lock is released afterwards.
    assert.equal((await send(cookie, 'third')).statusCode, 200);
  });

  it('does not let one busy session block another', async () => {
    const one = await startSession();
    const two = await startSession();
    ai.hold();

    const pendingOne = send(one, 'from one');
    while (ai.requests.length === 0) await new Promise((resolve) => setImmediate(resolve));
    const pendingTwo = send(two, 'from two');
    while (ai.requests.length < 2) await new Promise((resolve) => setImmediate(resolve));
    ai.release();

    assert.equal((await pendingOne).statusCode, 200);
    assert.equal((await pendingTwo).statusCode, 200);
  });

  it('requires a valid session cookie', async () => {
    const missing = await send(undefined, 'hi');
    assert.equal(missing.statusCode, 401);
    assert.equal(missing.json<ApiErrorResponse>().error.code, 'chat_session_required');

    const malformed = await send('portfolio_chat=not-a-session-id', 'hi');
    assert.equal(malformed.statusCode, 401);

    const unknown = await send(`portfolio_chat=${'A'.repeat(43)}`, 'hi');
    assert.equal(unknown.statusCode, 401);
    assert.equal(store.locks.size, 0, 'unknown sessions must not create lock keys');
    assert.equal(ai.requests.length, 0);
  });

  it('treats an expired session as missing and does not resurrect it', async () => {
    const cookie = await startSession();
    store.sessions.clear();
    assert.equal((await send(cookie, 'hi')).statusCode, 401);
    assert.equal(store.sessions.size, 0);
  });

  it('rejects empty, oversized, and unexpected message bodies with 400', async () => {
    const cookie = await startSession();
    assert.equal((await send(cookie, '   ')).statusCode, 400);
    assert.equal((await send(cookie, 'x'.repeat(1_001))).statusCode, 400);
    assert.equal((await send(cookie, 42)).statusCode, 400);
    const extra = await app.inject({
      method: 'POST',
      url: '/api/v1/chat/messages',
      headers: { cookie },
      payload: { message: 'hi', model: 'something-else' },
    });
    assert.equal(extra.statusCode, 400, 'visitors cannot pass model or prompt options');
    assert.equal(ai.requests.length, 0);
  });

  it('maps provider failures to typed errors without upstream text, and releases the lock', async () => {
    const cookie = await startSession();

    ai.failWith = new AiOverloadedError(429);
    const overloaded = await send(cookie, 'hi');
    assert.equal(overloaded.statusCode, 503);
    assert.equal(overloaded.json<ApiErrorResponse>().error.code, 'ai_overloaded');

    ai.failWith = new AiUnavailableError('timeout');
    const unavailable = await send(cookie, 'hi');
    assert.equal(unavailable.json<ApiErrorResponse>().error.code, 'ai_unavailable');
    assert.doesNotMatch(unavailable.body, /timeout/);

    ai.failWith = undefined;
    assert.equal((await send(cookie, 'hi')).statusCode, 200, 'the lock must not leak on failure');
    const sessionId = sessionIdFromCookieHeader(cookie) ?? '';
    assert.equal(store.sessions.get(sessionId)?.history.length, 2, 'failed turns are not stored');
  });

  it('refuses sessions and messages while AI is disabled', async () => {
    const cookie = await startSession();
    ai.enabled = false;

    const create = await app.inject({ method: 'POST', url: '/api/v1/chat/sessions' });
    assert.equal(create.statusCode, 503);
    assert.equal(create.json<ApiErrorResponse>().error.code, 'ai_disabled');
    assert.equal(create.headers['set-cookie'], undefined);

    const message = await send(cookie, 'hi');
    assert.equal(message.json<ApiErrorResponse>().error.code, 'ai_disabled');
  });
});

describe('promptHistory', () => {
  const turn = (role: 'user' | 'assistant', content: string) => ({ role, content });

  it('keeps at most the newest 8 turns, in order', () => {
    const history = Array.from({ length: 12 }, (_, index) =>
      turn(index % 2 === 0 ? 'user' : 'assistant', `t${index}`),
    );
    assert.deepEqual(
      promptHistory(history).map(({ content }) => content),
      ['t4', 't5', 't6', 't7', 't8', 't9', 't10', 't11'],
    );
  });

  it('stays within the character budget and never starts with an assistant turn', () => {
    const history = [
      turn('user', 'a'.repeat(3_000)),
      turn('assistant', 'b'.repeat(500)),
      turn('user', 'c'.repeat(500)),
      turn('assistant', 'd'.repeat(500)),
    ];
    const selected = promptHistory(history);
    assert.equal(selected[0]?.role, 'user');
    assert.ok(selected.reduce((sum, { content }) => sum + content.length, 0) <= 4_000);
    assert.deepEqual(
      selected.map(({ content }) => content[0]),
      ['c', 'd'],
    );
  });
});
