import test from 'node:test';
import assert from 'node:assert/strict';
import { FakeKV } from './helpers.js';
import { capStatus, takeCap, refundCap, ipGate, launchGate, utcDay, capFrom, DEFAULT_DAILY_CAP } from '../src/limits.js';

test('capFrom: default 25, accepts numbers, rejects junk', () => {
  assert.equal(DEFAULT_DAILY_CAP, 25);
  assert.equal(capFrom(undefined), 25); assert.equal(capFrom('abc'), 25); assert.equal(capFrom('-3'), 25);
  assert.equal(capFrom('10'), 10); assert.equal(capFrom('0'), 0);
});

test('daily cap counts up, stops at the cap, then refuses', async () => {
  const kv = new FakeKV();
  for (let i = 1; i <= 3; i++) { const r = await takeCap(kv, 3); assert.equal(r.ok, true); assert.equal(r.used, i); assert.equal(r.remaining, 3 - i); }
  const r = await takeCap(kv, 3);
  assert.equal(r.ok, false); assert.equal(r.remaining, 0);
  assert.deepEqual({ used: (await capStatus(kv, 3)).used }, { used: 3 });
});

test('cap of 0 refuses everything; refund gives a check back', async () => {
  const kv = new FakeKV();
  assert.equal((await takeCap(kv, 0)).ok, false);
  const kv2 = new FakeKV();
  await takeCap(kv2, 1); assert.equal((await takeCap(kv2, 1)).ok, false);
  await refundCap(kv2); assert.equal((await takeCap(kv2, 1)).ok, true);
  const kv3 = new FakeKV(); await refundCap(kv3); assert.equal((await capStatus(kv3, 5)).used, 0); // never goes negative
});

test('cap is keyed on the UTC day, so it resets at UTC midnight', async () => {
  const kv = new FakeKV();
  const d1 = Date.UTC(2026, 9, 26, 23, 59, 0), d2 = Date.UTC(2026, 9, 27, 0, 0, 1);
  assert.equal(utcDay(d1), '2026-10-26'); assert.equal(utcDay(d2), '2026-10-27');
  await takeCap(kv, 1, d1);
  assert.equal((await takeCap(kv, 1, d1)).ok, false);
  assert.equal((await takeCap(kv, 1, d2)).ok, true);
});

test('per-IP gate: one live check per 20s, hashed key, other IPs unaffected', async () => {
  const kv = new FakeKV();
  const t = 1_000_000;
  assert.equal((await ipGate(kv, '1.2.3.4', t)).ok, true);
  const r = await ipGate(kv, '1.2.3.4', t + 5000);
  assert.equal(r.ok, false); assert.equal(r.retryAfter, 15);
  assert.equal((await ipGate(kv, '5.6.7.8', t + 5000)).ok, true);
  assert.equal((await ipGate(kv, '1.2.3.4', t + 20_000)).ok, true);
  for (const k of kv.m.keys()) assert.ok(!k.includes('1.2.3.4'), 'raw IP must not be stored');
});

test('launch spacing: account-wide 21s between browser starts', async () => {
  const kv = new FakeKV();
  const t = 2_000_000;
  assert.equal((await launchGate(kv, t)).ok, true);
  const r = await launchGate(kv, t + 1000);
  assert.equal(r.ok, false); assert.equal(r.retryAfter, 20);
  assert.equal((await launchGate(kv, t + 21_000)).ok, true);
});
