import indexHtml from '../public/index.html';
import appJs from '../public/app.js';
import styleCss from '../public/style.css';
import soundJs from '../public/sound.js';
import displayFont from '../public/fonts/display.woff2';
import monoFont from '../public/fonts/mono.woff2';
import { checkUrlResolved, normalizeUrl } from './ssrf.js';
import { scoreResult, POSES, DPR } from './score.js';
import { getCached, putCached, putShot, getShot, sha256Hex } from './cache.js';
import { capFrom, capStatus, takeCap, refundCap, ipGate, launchGate } from './limits.js';
import { renderAll } from './render.js';

const json = (body, status = 200, extra = {}) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...extra } });
const asset = (body, type, maxAge) => new Response(body, { headers: { 'content-type': type, 'cache-control': maxAge ? `public, max-age=${maxAge}, immutable` : 'no-cache' } });
const SEC = { 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer' };

function publicResult(r, cached) {
  return { ...r, cached, shots: Object.fromEntries(Object.keys(POSES).map((p) => [p, `/api/shot/${r.id}/${p}`])) };
}

async function check(request, env) {
  let body;
  try { body = await request.json(); } catch { return json({ error: 'bad-request', message: 'Send JSON like {"url":"example.com"}.' }, 400); }
  const guard = await checkUrlResolved(body && body.url);
  if (!guard.ok) return json({ error: 'bad-url', message: guard.reason }, 400);
  const target = normalizeUrl(guard.url);
  const kv = env.KV;
  const cap = capFrom(env.DAILY_CAP);

  const hit = await getCached(kv, target);
  if (hit) return json(publicResult(hit, true));

  const status = await capStatus(kv, cap);
  if (status.remaining <= 0) return json({ error: 'cap', message: 'Out of ink for today. The free-plan browser budget is spent. Try again later (it resets at 8 PM Eastern).', ...status }, 429);
  const ip = request.headers.get('cf-connecting-ip') || 'unknown';
  const g1 = await ipGate(kv, ip);
  if (!g1.ok) return json({ error: 'rate', message: `Easy there. One fresh check every 20 seconds per person. Try again in ${g1.retryAfter}s.`, retryAfter: g1.retryAfter }, 429, { 'retry-after': String(g1.retryAfter) });
  const g2 = await launchGate(kv);
  if (!g2.ok) return json({ error: 'busy', message: `Someone else is mid-check and the free browser can only start one per 20s. Try again in ${g2.retryAfter}s.`, retryAfter: g2.retryAfter }, 429, { 'retry-after': String(g2.retryAfter) });
  const taken = await takeCap(kv, cap);
  if (!taken.ok) return json({ error: 'cap', message: 'Out of ink for today. Try again later.', ...taken }, 429);

  let r;
  try {
    r = await renderAll(env, guard.url.href);
  } catch (e) {
    if (e.launch) {
      await refundCap(kv);
      if (e.rateLimited) return json({ error: 'busy', message: 'Cloudflare says the free browser is busy right now. Try again in 20 seconds.', retryAfter: 20 }, 429, { 'retry-after': '20' });
      return json({ error: 'no-browser', message: 'The headless browser would not start. Try again soon.' }, 503);
    }
    if (e.blocked) return json({ error: 'bad-url', message: 'That site redirected somewhere private. Public sites only.' }, 400);
    const msg = String(e.message || e);
    const friendly = /ERR_NAME_NOT_RESOLVED/.test(msg) ? 'That domain does not exist. Typo?' : /ERR_CERT|SSL/.test(msg) ? 'That site has a broken HTTPS certificate.' : /blockedbyclient/.test(msg) ? 'That site tried to go somewhere private. Public sites only.' : 'Could not load that site. It may be down or blocking bots.';
    return json({ error: 'load-failed', message: friendly }, 502);
  }

  const id = (await sha256Hex(target + '|' + Date.now())).slice(0, 16);
  await Promise.all(Object.keys(POSES).map((p) => putShot(kv, id, p, r.shots[p])));
  const sc = scoreResult({ folded: r.poses.folded, landscape: r.poses.landscape, viewportMeta: !!r.viewportMeta });
  const result = {
    id, url: guard.url.href, finalUrl: r.finalUrl, title: r.title, checkedAt: Date.now(), slow: r.slow,
    viewportMeta: r.viewportMeta, poses: r.poses, ...sc,
    portraitOverflow: r.poses.portrait.layoutWidth > POSES.portrait.w + 1,
    dpr: DPR,
  };
  await putCached(kv, target, result);
  return json({ ...publicResult(result, false), remaining: taken.remaining });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const p = url.pathname;
    if (request.method === 'GET' || request.method === 'HEAD') {
      if (p === '/' || p === '/index.html') return new Response(indexHtml, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-cache', ...SEC } });
      if (p === '/app.js') return asset(appJs, 'text/javascript; charset=utf-8');
      if (p === '/sound.js') return asset(soundJs, 'text/javascript; charset=utf-8');
      if (p === '/style.css') return asset(styleCss, 'text/css; charset=utf-8');
      if (p === '/fonts/display.woff2') return asset(displayFont, 'font/woff2', 31536000);
      if (p === '/fonts/mono.woff2') return asset(monoFont, 'font/woff2', 31536000);
      if (p === '/api/status') return json(await capStatus(env.KV, capFrom(env.DAILY_CAP)));
      const m = /^\/api\/shot\/([a-f0-9]{16})\/(folded|landscape|portrait)$/.exec(p);
      if (m) {
        const buf = await getShot(env.KV, m[1], m[2]);
        if (!buf) return new Response('expired', { status: 404 });
        return new Response(buf, { headers: { 'content-type': 'image/jpeg', 'cache-control': 'private, max-age=3000', ...SEC } });
      }
    }
    if (p === '/api/check' && request.method === 'POST') return check(request, env);
    return new Response('not found', { status: 404 });
  },
};
