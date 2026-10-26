// Duo Check front end. No framework. Talks to POST /api/check, draws the share card on a canvas.
(() => {
  const $ = (id) => document.getElementById(id);
  const stage = $('stage'), form = $('form'), urlIn = $('url'), go = $('go');
  const POSE = { folded: { label: 'Folded', size: '382 × 580' }, landscape: { label: 'Unfolded', size: '951 × 585' }, portrait: { label: 'Unfolded, portrait', size: '669 × 867' } };
  const ORDER = ['folded', 'landscape', 'portrait'];
  const S = { pose: 'folded', result: null, busy: false, timers: [] };

  /* ---------- placeholder screens (inline SVG, so the mockup looks alive before the first check) ---------- */
  function wall(w, h, lines) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}"><defs>
      <linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#1b1140"/><stop offset=".55" stop-color="#0b0c14"/><stop offset="1" stop-color="#16200a"/></linearGradient>
      <radialGradient id="a" cx=".25" cy=".2" r=".6"><stop offset="0" stop-color="#7a5cff" stop-opacity=".75"/><stop offset="1" stop-color="#7a5cff" stop-opacity="0"/></radialGradient>
      <radialGradient id="b" cx=".85" cy=".9" r=".55"><stop offset="0" stop-color="#c8ff2e" stop-opacity=".5"/><stop offset="1" stop-color="#c8ff2e" stop-opacity="0"/></radialGradient></defs>
      <rect width="${w}" height="${h}" fill="url(#g)"/><rect width="${w}" height="${h}" fill="url(#a)"/><rect width="${w}" height="${h}" fill="url(#b)"/>${lines}</svg>`;
    return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
  }
  const T = (x, y, size, text, fill, weight, anchor, extra) => `<text x="${x}" y="${y}" font-family="Avenir Next, Helvetica Neue, Arial, sans-serif" font-size="${size}" font-weight="${weight || 800}" fill="${fill}" text-anchor="${anchor || 'middle'}" ${extra || ''}>${text}</text>`;
  const PH = {
    folded: wall(382, 580, T(191, 150, 96, '9:41', '#f3f0e8', 800, 'middle', 'letter-spacing="-4"') + T(191, 196, 17, 'MONDAY · NOT A REAL DUO', '#8d919c', 600, 'middle', 'letter-spacing="3"') + T(191, 470, 30, 'paste a site.', '#c8ff2e') + T(191, 506, 30, 'watch it fold.', '#f3f0e8')),
    landscape: wall(951, 585, T(475, 250, 150, 'DUO CHECK', '#f3f0e8', 800, 'middle', 'letter-spacing="-8"') + T(475, 330, 30, 'does it survive the fold?', '#c8ff2e', 700) + T(475, 530, 18, 'CHROMIUM AT WEBKIT’S PUBLISHED SIZES', '#565a65', 600, 'middle', 'letter-spacing="4"')),
    portrait: wall(669, 867, T(334, 380, 118, 'DUO', '#f3f0e8', 800, 'middle', 'letter-spacing="-5"') + T(334, 490, 118, 'CHECK', '#c8ff2e', 800, 'middle', 'letter-spacing="-5"') + T(334, 570, 26, 'portrait mode, for the brave', '#8d919c', 600)),
  };

  /* ---------- layout: sizes for the CSS mockup ---------- */
  const B = 8;
  function layout() {
    const W = stage.clientWidth || 358;
    const openW = Math.min(W - 6, 640);
    const sh = (openW - 2 * B) * 585 / 951;
    const H = sh + 2 * B;
    const wo = openW / 2;
    const wc = (H - 2 * B) * 382 / 580 + 2 * B;
    const maxH = Math.min(Math.max(window.innerHeight * 0.5, 330), 470);
    const k = Math.max(1, Math.min(maxH / H, (W - 40) / wc));
    let ph = maxH * 0.96, pw = (ph - 2 * B) * 669 / 867 + 2 * B;
    if (pw > W - 30) { pw = W - 30; ph = (pw - 2 * B) * 867 / 669 + 2 * B; }
    const set = (n, v) => stage.style.setProperty(n, typeof v === 'number' ? v.toFixed(2) + 'px' : v);
    set('--b', B); set('--H', H); set('--wo', wo); set('--wc', wc); set('--k', k.toFixed(3)); set('--pw', pw); set('--ph', ph);
    stage.style.setProperty('--b', B + 'px');
    S.heights = { folded: H * k + 34, landscape: H + 70, portrait: ph + 34 };
    stage.style.setProperty('--sh', S.heights[S.pose] + 'px');
  }

  /* ---------- poses ---------- */
  const leafB = $('leaf-b');
  function setPose(p, { sound = true } = {}) {
    if (p === S.pose) return;
    const from = S.pose; S.pose = p;
    stage.dataset.pose = p;
    stage.style.setProperty('--sh', S.heights[p] + 'px');
    leafB.classList.remove('moving'); void leafB.offsetWidth; leafB.classList.add('moving');
    $('seg').style.setProperty('--i', ORDER.indexOf(p));
    document.querySelectorAll('#seg button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.pose === p)));
    $('pose-note').innerHTML = `<b>${POSE[p].label}</b> <span>${POSE[p].size}</span>`;
    $('fold-label').textContent = p === 'folded' ? 'Unfold it' : 'Fold it back';
    if (sound && window.DuoSound) DuoSound.play(p === 'folded' ? 'fold' : (from === 'folded' ? 'unfold' : 'tick'));
    document.dispatchEvent(new CustomEvent('duo-pose', { detail: { pose: p, from } }));
  }
  function loadImages(map) { $('img-f').src = map.folded; $('img-a').src = map.landscape; $('img-b').src = map.landscape; $('img-p').src = map.portrait; }

  /* ---------- status line + errors ---------- */
  const MSGS = ['Waking up a headless browser…', 'Unfolding your CSS…', 'Measuring for sideways scroll…', 'Interrogating the viewport tag…', 'Asking the hinge how it feels…', 'Squinting at your footer…', 'Almost. Browsers are slow, bro…'];
  function loading(on) {
    S.busy = on; go.disabled = on; stage.dataset.state = on ? 'loading' : 'idle';
    $('status').hidden = !on;
    S.timers.forEach(clearInterval); S.timers = [];
    if (on) {
      let i = 0; $('status-text').textContent = MSGS[0];
      S.timers.push(setInterval(() => { $('status-text').textContent = MSGS[++i % MSGS.length]; }, 1700));
      S.timers.push(setInterval(() => { if (!S.result) setPose(S.pose === 'folded' ? 'landscape' : 'folded', { sound: false }); }, 2400));
    }
  }
  function showMsg(text, retry) {
    $('msg').hidden = !text; $('msg-text').textContent = text || '';
    const btn = $('msg-retry'); btn.hidden = true; clearInterval(S.cd);
    if (retry) {
      let left = retry; btn.hidden = false; btn.disabled = true; btn.textContent = `Try again in ${left}s`;
      S.cd = setInterval(() => { left--; if (left <= 0) { clearInterval(S.cd); btn.disabled = false; btn.textContent = 'Try again'; } else btn.textContent = `Try again in ${left}s`; }, 1000);
    }
  }
  let toastT;
  function toast(t) { const el = $('toast'); el.textContent = t; el.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => el.classList.remove('show'), 2200); }

  async function refreshMeter() {
    try { const s = await (await fetch('/api/status')).json(); $('meter').textContent = `${s.remaining}/${s.cap} fresh checks left today · repeats free`; }
    catch { /* meter is cosmetic */ }
  }

  /* ---------- the check ---------- */
  async function runCheck(raw) {
    if (S.busy) return;
    showMsg('');
    if (window.DuoSound) DuoSound.unlock();
    $('result').hidden = true; S.result = null; $('samples').hidden = true;
    $('controls').classList.remove('ready'); $('fold-btn').classList.remove('nudge');
    loadImages(PH); setPose('folded', { sound: false });
    loading(true);
    let data, status = 0;
    try {
      const r = await fetch('/api/check', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url: raw }) });
      status = r.status; data = await r.json();
    } catch { data = { error: 'network', message: 'Could not reach Duo Check. Check your connection and retry.' }; }
    loading(false);
    if (!data || data.error) {
      if (window.DuoSound && data && data.error !== 'bad-url') DuoSound.play('sting', 0);
      showMsg((data && data.message) || 'Something broke. Try again.', data && data.retryAfter);
      $('controls').classList.add('ready'); $('samples').hidden = false; loadImages(PH); refreshMeter();
      return;
    }
    S.result = data; show(data); refreshMeter();
  }

  function show(d) {
    $('img-f').src = d.shots.folded; $('img-a').src = d.shots.landscape; $('img-b').src = d.shots.landscape; $('img-p').src = d.shots.portrait;
    $('controls').classList.add('ready'); $('fold-btn').classList.add('nudge');
    const host = (() => { try { return new URL(d.finalUrl || d.url).host; } catch { return d.url; } })();
    $('host').textContent = host + (d.title ? ' · ' + d.title : '');
    $('score-num').textContent = d.score; $('ring').dataset.score = d.score;
    $('verdict-title').textContent = d.verdict.title; $('verdict-line').textContent = d.verdict.line;
    const ul = $('checks'); ul.innerHTML = '';
    d.checks.forEach((c, i) => {
      const li = document.createElement('li'); li.className = c.pass ? 'pass' : 'fail'; li.style.animationDelay = (0.25 + i * 0.12) + 's';
      let detail = c.detail;
      if (!c.pass && c.id === 'folded' && d.poses.folded.culprit) detail += ' · culprit: ' + d.poses.folded.culprit;
      if (!c.pass && c.id === 'landscape' && d.poses.landscape.culprit) detail += ' · culprit: ' + d.poses.landscape.culprit;
      li.innerHTML = `<span class="ico">${c.pass ? '✓' : '✕'}</span><div><div class="t"></div><div class="d"></div></div>`;
      li.querySelector('.t').textContent = c.label; li.querySelector('.d').textContent = detail; ul.appendChild(li);
    });
    $('cached').textContent = d.cached ? `from cache · checked ${Math.max(1, Math.round((Date.now() - d.checkedAt) / 60000))} min ago` : 'fresh render · just now' + (d.slow ? ' · page was slow to settle' : '') + (d.portraitOverflow ? ' · portrait pose also scrolls sideways (not scored)' : '');
    $('result').hidden = false;
    $('ring-val').style.strokeDashoffset = 3;
    requestAnimationFrame(() => requestAnimationFrame(() => { $('ring-val').style.strokeDashoffset = (3 - d.score).toFixed(3); }));
    if (window.DuoSound) DuoSound.play('sting', d.score);
    drawCard(d);
    document.dispatchEvent(new CustomEvent('duo-result', { detail: d }));
  }

  /* ---------- share card (canvas 1080x1350) ---------- */
  function rr(c, x, y, w, h, r) { r = Math.min(r, w / 2, h / 2); c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath(); }
  function img(src) { return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; }); }
  async function drawCard(d) {
    const cv = $('card'), c = cv.getContext('2d'), W = 1080, H = 1350;
    try { await Promise.all([document.fonts.load('800 80px Bricolage'), document.fonts.load('500 24px JBMono')]); } catch { /* fall back to system fonts */ }
    let fi, li;
    try { [fi, li] = await Promise.all([img(d.shots.folded), img(d.shots.landscape)]); } catch { fi = li = null; }
    const col = ['#ff4d6d', '#ff8a4c', '#ffd84a', '#c8ff2e'][d.score];
    const bg = c.createLinearGradient(0, 0, W, H); bg.addColorStop(0, '#120b2e'); bg.addColorStop(.5, '#07080b'); bg.addColorStop(1, '#131c07');
    c.fillStyle = bg; c.fillRect(0, 0, W, H);
    const g1 = c.createRadialGradient(180, 120, 0, 180, 120, 620); g1.addColorStop(0, 'rgba(122,92,255,.55)'); g1.addColorStop(1, 'rgba(122,92,255,0)'); c.fillStyle = g1; c.fillRect(0, 0, W, H);
    const g2 = c.createRadialGradient(950, 1250, 0, 950, 1250, 560); g2.addColorStop(0, col + '66'); g2.addColorStop(1, col + '00'); c.fillStyle = g2; c.fillRect(0, 0, W, H);
    c.strokeStyle = 'rgba(255,255,255,.05)'; c.lineWidth = 1; for (let x = 0; x <= W; x += 54) { c.beginPath(); c.moveTo(x, 0); c.lineTo(x, H); c.stroke(); } for (let y = 0; y <= H; y += 54) { c.beginPath(); c.moveTo(0, y); c.lineTo(W, y); c.stroke(); }

    // logo + title
    c.fillStyle = '#c8ff2e'; rr(c, 64, 62, 22, 40, 7); c.fill(); c.globalAlpha = .42; rr(c, 92, 62, 22, 40, 7); c.fill(); c.globalAlpha = 1;
    c.fillStyle = '#f3f0e8'; c.font = '700 40px Bricolage, sans-serif'; c.textBaseline = 'alphabetic'; c.fillText('duo', 134, 98); const dw = c.measureText('duo').width; c.fillStyle = '#c8ff2e'; c.font = '800 40px Bricolage, sans-serif'; c.fillText('check', 134 + dw, 98);
    c.textAlign = 'right'; c.fillStyle = '#8d919c'; c.font = '500 24px JBMono, monospace'; c.fillText('FOLD TEST', W - 64, 96); c.textAlign = 'left';
    let host = d.url; try { host = new URL(d.finalUrl || d.url).host.replace(/^www\./, ''); } catch { /* keep raw */ }
    c.fillStyle = '#f3f0e8'; let fs = 84; c.font = `800 ${fs}px Bricolage, sans-serif`; while (c.measureText(host).width > W - 128 && fs > 36) { fs -= 4; c.font = `800 ${fs}px Bricolage, sans-serif`; }
    c.fillText(host, 64, 220);

    // unfolded device (landscape)
    const bz = 14, dw2 = 880, dh = Math.round((dw2 - 2 * bz) * 585 / 951 + 2 * bz), dx = (W - dw2) / 2, dy = 252;
    c.save(); c.shadowColor = 'rgba(0,0,0,.7)'; c.shadowBlur = 50; c.shadowOffsetY = 28; c.fillStyle = '#0a0b0e'; rr(c, dx, dy, dw2, dh, 44); c.fill(); c.restore();
    c.strokeStyle = 'rgba(255,255,255,.2)'; c.lineWidth = 2; rr(c, dx, dy, dw2, dh, 44); c.stroke();
    c.save(); rr(c, dx + bz, dy + bz, dw2 - 2 * bz, dh - 2 * bz, 32); c.clip(); c.fillStyle = '#000'; c.fillRect(dx, dy, dw2, dh); if (li) c.drawImage(li, dx + bz, dy + bz, dw2 - 2 * bz, dh - 2 * bz);
    const cx = dx + dw2 / 2; const cg = c.createLinearGradient(cx - 14, 0, cx + 14, 0); cg.addColorStop(0, 'rgba(0,0,0,0)'); cg.addColorStop(.46, 'rgba(0,0,0,.38)'); cg.addColorStop(.5, 'rgba(255,255,255,.22)'); cg.addColorStop(.56, 'rgba(0,0,0,.3)'); cg.addColorStop(1, 'rgba(0,0,0,0)'); c.fillStyle = cg; c.fillRect(cx - 14, dy, 28, dh); c.restore();
    c.fillStyle = '#565a65'; c.font = '500 22px JBMono, monospace'; c.fillText('UNFOLDED · 951 × 585', dx + 6, dy + dh + 40);

    // folded phone
    const fy = dy + dh + 72, fh = 340, fw = Math.round((fh - 2 * bz) * 382 / 580 + 2 * bz), fx = 64;
    c.save(); c.shadowColor = 'rgba(0,0,0,.7)'; c.shadowBlur = 40; c.shadowOffsetY = 22; c.fillStyle = '#0a0b0e'; rr(c, fx, fy, fw, fh, 40); c.fill(); c.restore();
    c.strokeStyle = 'rgba(255,255,255,.2)'; c.lineWidth = 2; rr(c, fx, fy, fw, fh, 40); c.stroke();
    // the island sits in a taller top bezel, so it never covers the page; the screenshot is top-anchored and loses a sliver at the bottom
    const ex = 16, sw = fw - 2 * bz, sh = fh - 2 * bz - ex;
    c.save(); rr(c, fx + bz, fy + bz + ex, sw, sh, 28); c.clip(); c.fillStyle = '#000'; c.fillRect(fx, fy, fw, fh); if (fi) c.drawImage(fi, 0, 0, fi.width, fi.height * sh / (fh - 2 * bz), fx + bz, fy + bz + ex, sw, sh); c.restore();
    c.fillStyle = '#000'; rr(c, fx + fw / 2 - 36, fy + 9, 72, 18, 9); c.fill();
    c.fillStyle = '#565a65'; c.font = '500 22px JBMono, monospace'; c.fillText('FOLDED · 382 × 580', fx + 4, fy + fh + 40);

    // score
    const sx = fx + fw + 56;
    c.fillStyle = col; c.font = '800 170px Bricolage, sans-serif'; c.fillText(String(d.score), sx - 6, fy + 140); const nw = c.measureText(String(d.score)).width;
    c.fillStyle = '#8d919c'; c.font = '600 56px JBMono, monospace'; c.fillText('/3', sx + nw + 6, fy + 140);
    c.fillStyle = '#f3f0e8'; c.font = '800 46px Bricolage, sans-serif';
    wrap(c, d.verdict.title, sx, fy + 204, W - sx - 64, 50, 2);
    c.fillStyle = '#8d919c'; c.font = '500 26px Bricolage, sans-serif';
    d.checks.forEach((k, i) => { const y = fy + 292 + i * 38; c.fillStyle = k.pass ? '#c8ff2e' : '#ff4d6d'; c.font = '800 28px Bricolage, sans-serif'; c.fillText(k.pass ? '✓' : '✕', sx, y); c.fillStyle = '#d6d3cb'; c.font = '600 25px Bricolage, sans-serif'; c.fillText(shortCheck(k.id), sx + 40, y); });

    // footer
    c.fillStyle = '#565a65'; c.font = '500 20px JBMono, monospace'; c.fillText('Chromium at WebKit’s sizes · not real Safari', 64, H - 52);
    c.fillStyle = '#c8ff2e'; c.textAlign = 'right'; c.font = '600 22px JBMono, monospace'; c.fillText(location.host || 'duo-check', W - 64, H - 52); c.textAlign = 'left';
    document.dispatchEvent(new CustomEvent('duo-card'));
  }
  const shortCheck = (id) => ({ folded: 'no sideways scroll, folded', landscape: 'no sideways scroll, unfolded', viewport: 'viewport meta tag' }[id] || id);
  function wrap(c, text, x, y, maxW, lh, maxLines) {
    const words = text.split(' '); let line = '', n = 0;
    for (const w of words) { const t = line ? line + ' ' + w : w; if (c.measureText(t).width > maxW && line) { c.fillText(line, x, y + n * lh); line = w; if (++n >= maxLines) return; } else line = t; }
    c.fillText(line, x, y + n * lh);
  }
  const cardBlob = () => new Promise((res) => $('card').toBlob(res, 'image/png'));
  async function saveCard() {
    const b = await cardBlob(); if (!b) return toast('Could not make the card');
    const a = document.createElement('a'); a.href = URL.createObjectURL(b);
    let h = 'site'; try { h = new URL(S.result.finalUrl).hostname.replace(/[^a-z0-9.-]/gi, '-'); } catch { /* default */ }
    a.download = `duo-check-${h}.png`; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); toast('Card saved');
    if (window.DuoSound) DuoSound.play('tick');
  }
  async function shareCard() {
    const text = `${S.result ? S.result.score : '?'}/3 on Duo Check. Does your site survive the fold?`;
    try {
      const b = await cardBlob(); const f = new File([b], 'duo-check.png', { type: 'image/png' });
      if (navigator.canShare && navigator.canShare({ files: [f] })) { await navigator.share({ files: [f], title: 'Duo Check', text, url: location.origin }); return; }
      if (navigator.share) { await navigator.share({ title: 'Duo Check', text, url: location.origin }); return; }
    } catch (e) { if (e && e.name === 'AbortError') return; }
    try { await navigator.clipboard.writeText(`${text} ${location.origin}`); toast('Link copied'); } catch { toast('Copy: ' + location.origin); }
  }

  /* ---------- wiring ---------- */
  form.addEventListener('submit', (e) => { e.preventDefault(); runCheck(urlIn.value); });
  $('samples').addEventListener('click', (e) => { const b = e.target.closest('button[data-url]'); if (!b) return; urlIn.value = b.dataset.url; if (window.DuoSound) DuoSound.unlock(); runCheck(b.dataset.url); });
  $('chips').addEventListener('click', (e) => { const b = e.target.closest('button[data-url]'); if (!b) return; urlIn.value = b.dataset.url; if (window.DuoSound) DuoSound.unlock(); runCheck(b.dataset.url); });
  $('seg').addEventListener('click', (e) => { const b = e.target.closest('button[data-pose]'); if (!b || !$('controls').classList.contains('ready')) return; if (window.DuoSound) DuoSound.unlock(); $('fold-btn').classList.remove('nudge'); setPose(b.dataset.pose); });
  $('fold-btn').addEventListener('click', () => { if (window.DuoSound) DuoSound.unlock(); $('fold-btn').classList.remove('nudge'); setPose(S.pose === 'folded' ? 'landscape' : 'folded'); });
  stage.addEventListener('click', () => { if ($('controls').classList.contains('ready') && S.result) { if (window.DuoSound) DuoSound.unlock(); $('fold-btn').classList.remove('nudge'); setPose(S.pose === 'folded' ? 'landscape' : 'folded'); } });
  $('msg-retry').addEventListener('click', () => runCheck(urlIn.value));
  $('save-btn').addEventListener('click', saveCard);
  $('share-btn').addEventListener('click', shareCard);
  $('again-btn').addEventListener('click', () => { $('result').hidden = true; $('samples').hidden = false; S.result = null; loadImages(PH); setPose('folded', { sound: false }); $('controls').classList.remove('ready'); window.scrollTo({ top: 0, behavior: 'smooth' }); urlIn.value = ''; urlIn.focus(); });

  const mute = $('mute-btn'), music = $('music-btn');
  function syncAudioBtns() { mute.setAttribute('aria-pressed', String(DuoSound.muted)); mute.setAttribute('aria-label', DuoSound.muted ? 'Unmute sound' : 'Mute sound'); music.setAttribute('aria-pressed', String(DuoSound.musicOn)); }
  mute.addEventListener('click', () => { DuoSound.unlock(); DuoSound.setMuted(!DuoSound.muted); syncAudioBtns(); });
  music.addEventListener('click', () => { DuoSound.unlock(); DuoSound.setMusic(!DuoSound.musicOn); syncAudioBtns(); });
  syncAudioBtns();

  window.addEventListener('resize', layout);
  loadImages(PH); layout(); refreshMeter();
  $('seg').style.setProperty('--i', 0);
  $('controls').classList.add('ready');   // pose buttons work on the placeholder screens too
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(layout);
  window.__duo = { setPose, layout, runCheck, state: S };
})();
