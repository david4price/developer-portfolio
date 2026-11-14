import assert from 'node:assert/strict';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { after, before, beforeEach, describe, it } from 'node:test';
import { CHAT_SESSION_CHALLENGE_ACTION } from '@portfolio/shared-types';
import { CloudflareSessionChallenge } from '../src/modules/chat/cloudflare-session-challenge.js';
import { ChallengeUnavailableError } from '../src/modules/chat/session-challenge.js';

describe('CloudflareSessionChallenge (contract, fake server)', () => {
  let origin = '';
  let handle: (request: IncomingMessage, response: ServerResponse) => void;
  const server = createServer((request, response) => handle(request, response));
  const success = {
    success: true,
    hostname: 'portfolio.example.com',
    action: CHAT_SESSION_CHALLENGE_ACTION,
  };

  before(async () => {
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    assert.ok(address !== null && typeof address !== 'string');
    origin = `http://127.0.0.1:${address.port}`;
  });
  beforeEach(() => {
    handle = (_request, response) => {
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify(success));
    };
  });
  after(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  });

  const adapter = (timeoutMs = 1_000) =>
    new CloudflareSessionChallenge(
      {
        secretKey: 'local-test-secret',
        hostnames: ['portfolio.example.com'],
        timeoutMs,
      },
      (url, options) => {
        assert.equal(url, 'https://challenges.cloudflare.com/turnstile/v0/siteverify');
        assert.equal(options?.redirect, 'error');
        return fetch(origin, options);
      },
    );

  it('posts the secret and token to the fixed endpoint and checks the claims', async () => {
    let body = '';
    handle = (request, response) => {
      assert.equal(request.method, 'POST');
      assert.equal(request.headers['content-type'], 'application/json');
      request.setEncoding('utf8');
      request.on('data', (chunk: string) => {
        body += chunk;
      });
      request.on('end', () => response.end(JSON.stringify(success)));
    };
    assert.equal(await adapter().verify('visitor-token'), true);
    assert.deepEqual(JSON.parse(body), { secret: 'local-test-secret', response: 'visitor-token' });
  });

  it('rejects unsuccessful, expired, replayed, wrong-host, and wrong-action tokens', async () => {
    for (const result of [
      { success: false, 'error-codes': ['invalid-input-response'] },
      { success: false, 'error-codes': ['timeout-or-duplicate'] },
      { ...success, hostname: 'attacker.example.com' },
      { ...success, hostname: 'sub.portfolio.example.com' },
      { ...success, action: 'other_form' },
      { success: true },
    ]) {
      handle = (_request, response) => response.end(JSON.stringify(result));
      assert.equal(await adapter().verify('visitor-token'), false, JSON.stringify(result));
    }
  });

  it('treats configuration errors and upstream failures as unavailable', async () => {
    for (const code of ['invalid-input-secret', 'missing-input-secret', 'internal-error']) {
      handle = (_request, response) =>
        response.end(JSON.stringify({ success: false, 'error-codes': [code] }));
      await assert.rejects(adapter().verify('visitor-token'), ChallengeUnavailableError);
    }
    for (const status of [400, 429, 500, 503]) {
      handle = (_request, response) => {
        response.statusCode = status;
        response.end('private upstream details');
      };
      await assert.rejects(adapter().verify('visitor-token'), (error: unknown) => {
        assert.ok(error instanceof ChallengeUnavailableError);
        assert.doesNotMatch(error.message, /private|visitor-token|local-test-secret/);
        return true;
      });
    }
  });

  it('rejects malformed and oversized responses, including streamed bodies', async () => {
    for (const body of ['not json', '{}', '{"success":"true"}', 'x'.repeat(9_000)]) {
      handle = (_request, response) => response.end(body);
      await assert.rejects(adapter().verify('visitor-token'), ChallengeUnavailableError);
    }
    handle = (_request, response) => {
      response.write('x'.repeat(5_000));
      response.end('x'.repeat(5_000));
    };
    await assert.rejects(adapter().verify('visitor-token'), ChallengeUnavailableError);
  });

  it('does not follow redirects', async () => {
    let requests = 0;
    handle = (_request, response) => {
      requests += 1;
      response.writeHead(302, { location: '/elsewhere' });
      response.end();
    };
    await assert.rejects(adapter().verify('visitor-token'), ChallengeUnavailableError);
    assert.equal(requests, 1);
  });

  it('times out both before headers and during a stalled response body', async () => {
    handle = () => {};
    await assert.rejects(adapter(40).verify('visitor-token'), ChallengeUnavailableError);
    handle = (_request, response) => {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.write('{"success":');
    };
    await assert.rejects(adapter(40).verify('visitor-token'), ChallengeUnavailableError);
  });

  it('returns a typed unavailable error on network failures', async () => {
    const verifier = new CloudflareSessionChallenge(
      { secretKey: 'test-secret', hostnames: ['example.com'] },
      async () => {
        throw new Error('private connection details');
      },
    );
    await assert.rejects(verifier.verify('visitor-token'), ChallengeUnavailableError);
  });
});
