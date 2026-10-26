// Headless Chromium via the Browser Rendering binding. One browser, three pages (one per pose), one screenshot each.
// It is Chromium at WebKit's published Safari sizes, not Safari. It sends an iPhone Safari user agent so sites serve their phone layout.
import puppeteer from '@cloudflare/puppeteer';
import { POSES, DPR } from './score.js';
import { checkParsedUrl, checkUrlResolved } from './ssrf.js';

const IOS_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const NAV_TIMEOUT = 12_000;

/** Runs inside the page. Returns plain numbers/strings only. */
function measure(poseWidth) {
  const de = document.documentElement;
  const body = document.body;
  const layoutWidth = Math.max(de.scrollWidth, body ? body.scrollWidth : 0);
  const vp = document.querySelector('meta[name="viewport" i]');
  let culprit = '';
  if (layoutWidth > poseWidth + 1) {
    let worst = 0;
    const els = document.querySelectorAll('body *');
    for (let i = 0; i < els.length && i < 4000; i++) {
      const r = els[i].getBoundingClientRect();
      if (r.width > 0 && r.right > worst + 1 && r.right > poseWidth + 1) {
        const cs = getComputedStyle(els[i]);
        if (cs.position === 'fixed' || cs.visibility === 'hidden') continue;
        worst = r.right;
        const id = els[i].id ? '#' + els[i].id : '';
        const cls = typeof els[i].className === 'string' && els[i].className.trim() ? '.' + els[i].className.trim().split(/\s+/).slice(0, 2).join('.') : '';
        culprit = els[i].tagName.toLowerCase() + id + cls + ' (' + Math.round(r.right) + 'px)';
      }
    }
  }
  return {
    layoutWidth,
    viewportMeta: vp ? (vp.getAttribute('content') || '').slice(0, 120) : null,
    title: (document.title || '').slice(0, 120),
    culprit: culprit.slice(0, 120),
  };
}

async function openPose(browser, pose, url, resolveCache) {
  const spec = POSES[pose];
  const page = await browser.newPage();
  await page.setUserAgent(IOS_UA);
  await page.setViewport({ width: spec.w, height: spec.h, deviceScaleFactor: DPR, isMobile: true, hasTouch: true });
  // Redirect-aware SSRF guard: every top-level navigation is re-checked, including DNS, before it is allowed to go out.
  await page.setRequestInterception(true);
  page.on('request', async (req) => {
    try {
      const u = new URL(req.url());
      if (u.protocol === 'data:' || u.protocol === 'blob:' || u.protocol === 'about:') return req.continue();
      const lit = checkParsedUrl(u);
      if (!lit.ok) return req.abort('blockedbyclient');
      if (req.isNavigationRequest() && req.frame() === page.mainFrame()) {
        if (!resolveCache.has(u.hostname)) resolveCache.set(u.hostname, checkUrlResolved(u.href));
        const res = await resolveCache.get(u.hostname);
        if (!res.ok) return req.abort('blockedbyclient');
      }
      return req.continue();
    } catch { try { req.abort('failed'); } catch { /* already handled */ } }
  });
  let navError = null;
  try {
    await page.goto(url, { waitUntil: 'networkidle2', timeout: NAV_TIMEOUT });
  } catch (e) {
    navError = String(e && e.message || e);
    // A slow page that never goes idle is still a page. Only a hard failure (no document at all) is fatal.
    if (/ERR_|net::|blockedbyclient|Navigation failed|NS_/i.test(navError) && !/timeout/i.test(navError)) throw Object.assign(new Error(navError), { fatal: true });
  }
  await new Promise((r) => setTimeout(r, 500));
  const final = page.url();
  const m = await page.evaluate(measure, spec.w);
  const shot = await page.screenshot({ type: 'jpeg', quality: 72 });
  return { pose, m, shot, final, slow: !!navError };
}

/** Returns { finalUrl, title, viewportMeta, poses: {folded:{layoutWidth,culprit}, ...}, shots: {folded: Uint8Array, ...} } */
export async function renderAll(env, url) {
  let browser;
  try { browser = await puppeteer.launch(env.BROWSER); }
  catch (e) { throw Object.assign(new Error(String(e && e.message || e)), { launch: true, rateLimited: /429|rate limit/i.test(String(e && e.message)) }); }
  try {
    const resolveCache = new Map();
    const results = await Promise.all(Object.keys(POSES).map((p) => openPose(browser, p, url, resolveCache)));
    const by = Object.fromEntries(results.map((r) => [r.pose, r]));
    const finalUrl = by.folded.final;
    const fin = await checkUrlResolved(finalUrl);
    if (!fin.ok) throw Object.assign(new Error('redirected somewhere private'), { fatal: true, blocked: true });
    return {
      finalUrl,
      title: by.folded.m.title || by.landscape.m.title,
      viewportMeta: by.folded.m.viewportMeta,
      slow: results.some((r) => r.slow),
      poses: Object.fromEntries(results.map((r) => [r.pose, { layoutWidth: r.m.layoutWidth, culprit: r.m.culprit }])),
      shots: Object.fromEntries(results.map((r) => [r.pose, r.shot])),
    };
  } finally {
    try { await browser.close(); } catch { /* browser already gone */ }
  }
}
