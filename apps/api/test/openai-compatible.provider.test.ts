import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, beforeEach, describe, it } from 'node:test';
import {
  AiOverloadedError,
  AiUnavailableError,
  type AiCompletionRequest,
} from '../src/modules/ai/ai-provider.js';
import { OpenAiCompatibleProvider } from '../src/modules/ai/openai-compatible.provider.js';

interface RecordedRequest {
  readonly method: string | undefined;
  readonly url: string | undefined;
  readonly headers: IncomingMessage['headers'];
  readonly body: unknown;
}

type Handler = (request: IncomingMessage, response: ServerResponse) => void;

const request: AiCompletionRequest = {
  messages: [
    { role: 'system', content: 'You answer questions about the portfolio.' },
    { role: 'user', content: 'Which projects use Kubernetes?' },
  ],
  maxOutputTokens: 400,
};

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body));
}

const okBody = {
  id: 'chatcmpl-1',
  object: 'chat.completion',
  choices: [
    {
      index: 0,
      message: { role: 'assistant', content: 'The homelab project.' },
      finish_reason: 'stop',
    },
  ],
  usage: { prompt_tokens: 20, completion_tokens: 5, total_tokens: 25 },
};

/** Minimal OpenAI-style server. Each test installs its own handler. */
describe('OpenAiCompatibleProvider (contract, fake server)', () => {
  let server: Server;
  let baseUrl: string;
  let handler: Handler;
  let recorded: RecordedRequest[];
  /** Resolves when the server sees a client connection close before it answered. */
  let clientGone: Promise<void>;
  let markClientGone: () => void;

  before(async () => {
    server = createServer((incoming, response) => {
      const chunks: Buffer[] = [];
      incoming.on('data', (chunk: Buffer) => chunks.push(chunk));
      incoming.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        recorded.push({
          method: incoming.method,
          url: incoming.url,
          headers: incoming.headers,
          body: raw === '' ? null : (JSON.parse(raw) as unknown),
        });
        response.on('close', () => {
          if (!response.writableFinished) markClientGone();
        });
        handler(incoming, response);
      });
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const { port } = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${port}/engines/v1`;
  });

  beforeEach(() => {
    recorded = [];
    handler = (_incoming, response) => sendJson(response, 200, okBody);
    clientGone = new Promise((resolve) => {
      markClientGone = resolve;
    });
  });

  after(async () => {
    server.closeAllConnections();
    server.close();
    await once(server, 'close');
  });

  const provider = (options: { timeoutMs?: number; maxResponseBytes?: number } = {}) =>
    new OpenAiCompatibleProvider({ baseUrl, model: 'example-model', ...options });

  it('posts a non-streaming chat completion with the configured model and token cap', async () => {
    const completion = await provider().complete(request, AbortSignal.timeout(5_000));

    assert.deepEqual(completion, { content: 'The homelab project.', outputTokens: 5 });
    assert.equal(recorded.length, 1);
    const [sent] = recorded;
    assert.equal(sent?.method, 'POST');
    assert.equal(sent?.url, '/engines/v1/chat/completions');
    assert.equal(sent?.headers['content-type'], 'application/json');
    assert.equal(sent?.headers.authorization, undefined);
    assert.deepEqual(sent?.body, {
      model: 'example-model',
      messages: request.messages,
      max_tokens: 400,
      stream: false,
    });
  });

  it('joins a base URL with a trailing slash without doubling it', async () => {
    await new OpenAiCompatibleProvider({ baseUrl: `${baseUrl}/`, model: 'm' }).complete(
      request,
      AbortSignal.timeout(5_000),
    );
    assert.equal(recorded[0]?.url, '/engines/v1/chat/completions');
  });

  it('reports missing usage as unknown output tokens', async () => {
    handler = (_incoming, response) => sendJson(response, 200, { ...okBody, usage: undefined });
    const completion = await provider().complete(request, AbortSignal.timeout(5_000));
    assert.equal(completion.outputTokens, null);
  });

  for (const status of [429, 503]) {
    it(`maps ${status} to ai_overloaded`, async () => {
      handler = (_incoming, response) => sendJson(response, status, { error: { message: 'busy' } });
      await assert.rejects(provider().complete(request, AbortSignal.timeout(5_000)), (error) => {
        assert.ok(error instanceof AiOverloadedError);
        assert.equal(error.upstreamStatus, status);
        return true;
      });
    });
  }

  it('maps other error statuses to ai_unavailable without leaking the upstream message', async () => {
    const upstreamMessage = 'model crashed at /srv/models/private-path.gguf';
    handler = (_incoming, response) =>
      sendJson(response, 500, { error: { message: upstreamMessage } });

    await assert.rejects(provider().complete(request, AbortSignal.timeout(5_000)), (error) => {
      assert.ok(error instanceof AiUnavailableError);
      assert.equal(error.reason, 'upstream_status');
      assert.equal(error.upstreamStatus, 500);
      assert.doesNotMatch(error.message, /private-path|crashed/);
      assert.equal(error.cause, undefined);
      return true;
    });
  });

  it('times out a hung upstream with ai_unavailable and closes the connection', async () => {
    handler = () => undefined; // never answers
    const started = Date.now();

    await assert.rejects(
      provider({ timeoutMs: 100 }).complete(request, AbortSignal.timeout(5_000)),
      (error) => {
        assert.ok(error instanceof AiUnavailableError);
        assert.equal(error.reason, 'timeout');
        return true;
      },
    );
    assert.ok(Date.now() - started < 2_000, 'timeout must fire well before the caller deadline');
    await clientGone;
  });

  it('times out a reply that stalls mid-body', async () => {
    handler = (_incoming, response) => {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.write('{"choices":[');
    };
    await assert.rejects(
      provider({ timeoutMs: 100 }).complete(request, AbortSignal.timeout(5_000)),
      (error) => error instanceof AiUnavailableError && error.reason === 'timeout',
    );
  });

  it('propagates a caller abort unchanged and closes the connection', async () => {
    handler = () => undefined;
    const controller = new AbortController();
    const reason = new Error('client disconnected');
    const pending = provider().complete(request, controller.signal);
    setTimeout(() => controller.abort(reason), 50);

    await assert.rejects(pending, (error) => error === reason);
    await clientGone;
  });

  it('does not call the upstream when the caller has already aborted', async () => {
    const controller = new AbortController();
    controller.abort(new Error('gone'));
    await assert.rejects(provider().complete(request, controller.signal), /gone/);
    assert.equal(recorded.length, 0);
  });

  for (const [name, reply] of [
    ['non-JSON body', 'not json'],
    ['empty choices', JSON.stringify({ choices: [] })],
    ['null content', JSON.stringify({ choices: [{ message: { content: null } }] })],
  ] as const) {
    it(`rejects a malformed reply (${name}) as invalid_response`, async () => {
      handler = (_incoming, response) => {
        response.writeHead(200, { 'content-type': 'application/json' }).end(reply);
      };
      await assert.rejects(
        provider().complete(request, AbortSignal.timeout(5_000)),
        (error) => error instanceof AiUnavailableError && error.reason === 'invalid_response',
      );
    });
  }

  it('rejects an oversized reply, declared or streamed', async () => {
    const big = JSON.stringify({ ...okBody, padding: 'x'.repeat(4_096) });
    handler = (_incoming, response) => {
      response.writeHead(200, { 'content-type': 'application/json' }).end(big);
    };
    await assert.rejects(
      provider({ maxResponseBytes: 1_024 }).complete(request, AbortSignal.timeout(5_000)),
      (error) => error instanceof AiUnavailableError && error.reason === 'invalid_response',
    );

    handler = (_incoming, response) => {
      response.writeHead(200, { 'content-type': 'application/json' }); // chunked, no length
      response.write(big.slice(0, 2_048));
      response.end(big.slice(2_048));
    };
    await assert.rejects(
      provider({ maxResponseBytes: 1_024 }).complete(request, AbortSignal.timeout(5_000)),
      (error) => error instanceof AiUnavailableError && error.reason === 'invalid_response',
    );
  });

  it('refuses to follow redirects', async () => {
    handler = (_incoming, response) => {
      response.writeHead(307, { location: 'http://127.0.0.1:9/elsewhere' }).end();
    };
    await assert.rejects(
      provider().complete(request, AbortSignal.timeout(5_000)),
      (error) => error instanceof AiUnavailableError,
    );
    assert.equal(recorded.length, 1);
  });

  it('maps a refused connection to ai_unavailable (network)', async () => {
    const closed = createServer();
    closed.listen(0, '127.0.0.1');
    await once(closed, 'listening');
    const { port } = closed.address() as AddressInfo;
    closed.close();
    await once(closed, 'close');

    const unreachable = new OpenAiCompatibleProvider({
      baseUrl: `http://127.0.0.1:${port}/v1`,
      model: 'm',
    });
    await assert.rejects(
      unreachable.complete(request, AbortSignal.timeout(5_000)),
      (error) => error instanceof AiUnavailableError && error.reason === 'network',
    );
  });

  it('rejects invalid requests before calling the upstream', async () => {
    await assert.rejects(
      provider().complete({ ...request, maxOutputTokens: 0 }, AbortSignal.timeout(5_000)),
      RangeError,
    );
    await assert.rejects(
      provider().complete({ ...request, messages: [] }, AbortSignal.timeout(5_000)),
      RangeError,
    );
    assert.equal(recorded.length, 0);
  });

  it('rejects non-http base URLs at construction', () => {
    assert.throws(
      () => new OpenAiCompatibleProvider({ baseUrl: 'file:///etc/passwd', model: 'm' }),
      /http or https/,
    );
  });
});
