import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { Redis } from 'ioredis';
import { newSessionId } from '../../src/modules/chat/chat-cookie.js';
import { RedisChatSessionStore } from '../../src/modules/chat/redis-chat-session.store.js';

/** Exercises the Redis chat store against a real server. Skipped when REDIS_URL is unset. */
const redisUrl = process.env.REDIS_URL;

describe('RedisChatSessionStore', { skip: !redisUrl && 'REDIS_URL is not set' }, () => {
  let redis: Redis;
  let store: RedisChatSessionStore;
  const created: string[] = [];

  before(() => {
    redis = new Redis(redisUrl ?? '', { maxRetriesPerRequest: 1 });
    store = new RedisChatSessionStore(redis);
  });

  after(async () => {
    for (const id of created) {
      await redis.del(`portfolio:chat:session:${id}`, `portfolio:chat:lock:${id}`);
    }
    redis.disconnect();
  });

  const session = () => {
    const id = newSessionId();
    created.push(id);
    return id;
  };

  it('stores a session under a namespaced key with a TTL', async () => {
    const id = session();
    const created = await store.create(id, 120);
    assert.deepEqual(await store.load(id), created);
    const ttl = await redis.ttl(`portfolio:chat:session:${id}`);
    assert.ok(ttl > 100 && ttl <= 120, `unexpected TTL ${ttl}`);
  });

  it('saves history without extending the TTL', async () => {
    const id = session();
    const { expiresAt } = await store.create(id, 120);
    await redis.expire(`portfolio:chat:session:${id}`, 30);
    await store.saveHistory(id, { expiresAt, history: [{ role: 'user', content: 'hi' }] });
    assert.equal((await store.load(id))?.history.length, 1);
    assert.ok((await redis.ttl(`portfolio:chat:session:${id}`)) <= 30);
  });

  it('never resurrects an expired session', async () => {
    const id = session();
    await store.saveHistory(id, { expiresAt: new Date().toISOString(), history: [] });
    assert.equal(await store.load(id), undefined);
    assert.equal(await redis.exists(`portfolio:chat:session:${id}`), 0);
  });

  it('treats corrupt data as no session', async () => {
    const id = session();
    await redis.set(`portfolio:chat:session:${id}`, '{not json', 'EX', 60);
    assert.equal(await store.load(id), undefined);
    await redis.set(`portfolio:chat:session:${id}`, JSON.stringify({ history: 'nope' }), 'EX', 60);
    assert.equal(await store.load(id), undefined);
  });

  it('grants the lock to one holder, with a TTL', async () => {
    const id = session();
    assert.equal(await store.acquireLock(id, 'a', 5_000), true);
    assert.equal(await store.acquireLock(id, 'b', 5_000), false);
    const pttl = await redis.pttl(`portfolio:chat:lock:${id}`);
    assert.ok(pttl > 0 && pttl <= 5_000);
  });

  it('lets only the owner release the lock', async () => {
    const id = session();
    await store.acquireLock(id, 'owner', 5_000);
    await store.releaseLock(id, 'someone-else');
    assert.equal(
      await store.acquireLock(id, 'other', 5_000),
      false,
      'non-owner release is ignored',
    );
    await store.releaseLock(id, 'owner');
    assert.equal(await store.acquireLock(id, 'next', 5_000), true);
  });

  it('allows exactly one winner among concurrent lock attempts', async () => {
    const id = session();
    const results = await Promise.all(
      Array.from({ length: 20 }, (_, index) => store.acquireLock(id, `t${index}`, 5_000)),
    );
    assert.equal(results.filter(Boolean).length, 1);
  });
});
