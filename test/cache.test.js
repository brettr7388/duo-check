import test from 'node:test';
import assert from 'node:assert/strict';
import { FakeKV } from './helpers.js';
import { getCached, putCached, putShot, getShot, cacheKey, CACHE_TTL } from '../src/cache.js';

test('cache returns what was stored, keyed by normalized url', async () => {
  const kv = new FakeKV();
  assert.equal(await getCached(kv, 'https://example.com/'), null);
  await putCached(kv, 'https://example.com/', { id: 'abc', score: 3, checkedAt: Date.now() });
  assert.equal((await getCached(kv, 'https://example.com/')).score, 3);
  assert.equal(await getCached(kv, 'https://example.org/'), null);
  assert.notEqual(await cacheKey('https://example.com/'), await cacheKey('https://example.com/x'));
});

test('cache lasts 1 hour, then misses (KV ttl and checkedAt both enforced)', async () => {
  assert.equal(CACHE_TTL, 3600);
  const kv = new FakeKV();
  const t0 = Date.now();
  await putCached(kv, 'https://a.test/', { id: '1', checkedAt: t0 });
  assert.ok(await getCached(kv, 'https://a.test/', t0 + 59 * 60_000));
  assert.equal(await getCached(kv, 'https://a.test/', t0 + 61 * 60_000), null);
  kv.now = () => t0 + 3601_000; // KV itself expires the key
  assert.equal(await kv.get(await cacheKey('https://a.test/')), null);
});

test('screenshots round-trip as bytes', async () => {
  const kv = new FakeKV();
  const bytes = new Uint8Array([1, 2, 3, 4]).buffer;
  await putShot(kv, 'id1', 'folded', bytes);
  assert.deepEqual(new Uint8Array(await getShot(kv, 'id1', 'folded')), new Uint8Array([1, 2, 3, 4]));
  assert.equal(await getShot(kv, 'id1', 'landscape'), null);
});
