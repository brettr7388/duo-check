// Daily cap, per-IP rate limit and browser launch spacing. All KV based, no secrets, no raw IPs stored.
// KV is not atomic, so the cap is a friendly budget (the 20s launch spacing makes races rare), not a hard ledger.
// Cloudflare's own free limits are the real wall: 10 browser minutes/day, 3 concurrent, 1 new browser per 20s.
import { sha256Hex } from './cache.js';

export const DEFAULT_DAILY_CAP = 25;
export const IP_GAP_MS = 20_000;
export const LAUNCH_GAP_MS = 21_000;

export const utcDay = (now = Date.now()) => new Date(now).toISOString().slice(0, 10);
export const capFrom = (v) => { const n = parseInt(v, 10); return Number.isFinite(n) && n >= 0 ? n : DEFAULT_DAILY_CAP; };

export async function capStatus(kv, cap, now = Date.now()) {
  const used = parseInt((await kv.get('cap:' + utcDay(now))) || '0', 10) || 0;
  return { used, cap, remaining: Math.max(0, cap - used), day: utcDay(now) };
}

/** Reserve one check. Returns {ok:true, used} or {ok:false}. */
export async function takeCap(kv, cap, now = Date.now()) {
  const s = await capStatus(kv, cap, now);
  if (s.used >= cap) return { ok: false, ...s };
  await kv.put('cap:' + s.day, String(s.used + 1), { expirationTtl: 172800 });
  return { ok: true, ...s, used: s.used + 1, remaining: s.remaining - 1 };
}

export async function refundCap(kv, now = Date.now()) {
  const day = utcDay(now);
  const used = parseInt((await kv.get('cap:' + day)) || '0', 10) || 0;
  if (used > 0) await kv.put('cap:' + day, String(used - 1), { expirationTtl: 172800 });
}

/** One live check per IP per 20s. Stores only a hash. KV's minimum TTL is 60s. */
export async function ipGate(kv, ip, now = Date.now()) {
  const key = 'ip:' + (await sha256Hex('duo-check|' + ip)).slice(0, 32);
  const last = parseInt((await kv.get(key)) || '0', 10) || 0;
  const wait = last + IP_GAP_MS - now;
  if (wait > 0) return { ok: false, retryAfter: Math.ceil(wait / 1000) };
  await kv.put(key, String(now), { expirationTtl: 60 });
  return { ok: true };
}

/** Account-wide: Cloudflare allows 1 new browser per 20s. Keep our own spacing so visitors get a friendly wait, not a 429 from the API. */
export async function launchGate(kv, now = Date.now()) {
  const last = parseInt((await kv.get('launch:last')) || '0', 10) || 0;
  const wait = last + LAUNCH_GAP_MS - now;
  if (wait > 0) return { ok: false, retryAfter: Math.ceil(wait / 1000) };
  await kv.put('launch:last', String(now), { expirationTtl: 60 });
  return { ok: true };
}
