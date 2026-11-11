import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { describe, it } from 'node:test';
import { redisReadinessCheck, type RedisReadinessClient } from '../src/redis/redis.module.js';

class FakeRedis extends EventEmitter implements RedisReadinessClient {
  pings = 0;

  constructor(public status: string) {
    super();
  }

  async ping(): Promise<string> {
    if (this.status !== 'ready') throw new Error("Stream isn't writeable");
    this.pings += 1;
    return 'PONG';
  }

  becomeReady(): void {
    this.status = 'ready';
    this.emit('ready');
  }
}

describe('redisReadinessCheck', () => {
  it('pings immediately when the client is ready', async () => {
    const client = new FakeRedis('ready');
    await redisReadinessCheck(client).check();
    assert.equal(client.pings, 1);
  });

  it('waits for a connection in progress instead of reporting an outage', async () => {
    const client = new FakeRedis('connecting');
    setTimeout(() => client.becomeReady(), 10);

    await redisReadinessCheck(client, 500).check();
    assert.equal(client.pings, 1);
  });

  it('fails when Redis does not become ready, without leaking listeners', async () => {
    const client = new FakeRedis('reconnecting');
    const check = redisReadinessCheck(client, 20);

    for (let probe = 0; probe < 3; probe += 1) {
      await assert.rejects(check.check());
    }
    assert.equal(client.listenerCount('ready'), 0);
    assert.equal(client.pings, 0);
  });
});
