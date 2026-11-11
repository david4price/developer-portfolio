import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { processNoop } from '../src/jobs/noop.job.js';
import { loadWorkerConfig } from '../src/worker-config.js';

describe('processNoop', () => {
  it('echoes the request time with a processing time', () => {
    const result = processNoop(
      { requestedAt: '2026-01-01T00:00:00.000Z' },
      () => new Date('2026-01-01T00:00:01.000Z'),
    );
    assert.deepEqual(result, {
      requestedAt: '2026-01-01T00:00:00.000Z',
      processedAt: '2026-01-01T00:00:01.000Z',
    });
  });

  it('rejects malformed payloads', () => {
    assert.throws(() => processNoop({ requestedAt: 'yesterday' }));
    assert.throws(() => processNoop(null));
  });
});

describe('loadWorkerConfig', () => {
  it('requires a redis URL and bounds concurrency', () => {
    assert.throws(() => loadWorkerConfig({}), /REDIS_URL/);
    assert.throws(
      () => loadWorkerConfig({ REDIS_URL: 'redis://localhost:6379', WORKER_CONCURRENCY: '64' }),
      /WORKER_CONCURRENCY/,
    );
    assert.equal(loadWorkerConfig({ REDIS_URL: 'redis://localhost:6379' }).concurrency, 1);
  });
});
