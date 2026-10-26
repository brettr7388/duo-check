// 1 hour result cache in KV. Metadata under c:<hash>, screenshots under s:<id>:<pose>. Cache hits cost no browser time.
export const CACHE_TTL = 3600;

export async function sha256Hex(s) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function cacheKey(normalizedUrl) { return 'c:' + (await sha256Hex(normalizedUrl)).slice(0, 40); }

export async function getCached(kv, normalizedUrl, now = Date.now()) {
  const raw = await kv.get(await cacheKey(normalizedUrl));
  if (!raw) return null;
  let v; try { v = JSON.parse(raw); } catch { return null; }
  if (!v || now - v.checkedAt > CACHE_TTL * 1000) return null;
  return v;
}

export async function putCached(kv, normalizedUrl, result) {
  await kv.put(await cacheKey(normalizedUrl), JSON.stringify(result), { expirationTtl: CACHE_TTL });
}

export async function putShot(kv, id, pose, bytes) { await kv.put(`s:${id}:${pose}`, bytes, { expirationTtl: CACHE_TTL }); }
export async function getShot(kv, id, pose) { return kv.get(`s:${id}:${pose}`, 'arrayBuffer'); }
