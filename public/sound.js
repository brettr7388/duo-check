// Duo Check sound: everything is synthesized with WebAudio. No audio files.
// Voices take (ctx, dest, t) so the same code plays live and renders offline (OfflineAudioContext) for the demo video.
(function (root) {
  function noiseBuf(ctx, secs) {
    const n = Math.floor(ctx.sampleRate * secs);
    const b = ctx.createBuffer(1, n, ctx.sampleRate);
    const d = b.getChannelData(0);
    let s = 12345;                                    // seeded, so offline renders are repeatable
    for (let i = 0; i < n; i++) { s = (s * 1664525 + 1013904223) >>> 0; d[i] = (s / 4294967296) * 2 - 1; }
    return b;
  }
  function env(g, t, a, peak, d) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
  }
  function noise(ctx, dest, t, dur, type, f0, f1, peak, q) {
    const src = ctx.createBufferSource(); src.buffer = noiseBuf(ctx, dur + 0.05);
    const f = ctx.createBiquadFilter(); f.type = type; f.Q.value = q || 1;
    f.frequency.setValueAtTime(f0, t); f.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = ctx.createGain(); env(g, t, Math.min(0.03, dur / 3), peak, dur);
    src.connect(f); f.connect(g); g.connect(dest); src.start(t); src.stop(t + dur + 0.05);
  }
  function tone(ctx, dest, t, freq, dur, type, peak, glideTo) {
    const o = ctx.createOscillator(); o.type = type || 'sine'; o.frequency.setValueAtTime(freq, t);
    if (glideTo) o.frequency.exponentialRampToValueAtTime(glideTo, t + dur);
    const g = ctx.createGain(); env(g, t, 0.006, peak, dur);
    o.connect(g); g.connect(dest); o.start(t); o.stop(t + dur + 0.05);
  }
  const click = (ctx, d, t, p) => { noise(ctx, d, t, 0.018, 'highpass', 3500, 6500, p || 0.9, 0.7); tone(ctx, d, t, 180, 0.09, 'sine', (p || 0.9) * 0.9, 70); };

  const voices = {
    // Opening the hinge: a creaky sweep up, then the two-step latch click-clack.
    unfold(ctx, d, t) {
      noise(ctx, d, t, 0.42, 'bandpass', 300, 2600, 0.5, 4);
      tone(ctx, d, t, 90, 0.4, 'sawtooth', 0.05, 260);
      click(ctx, d, t + 0.42, 1);
      click(ctx, d, t + 0.52, 0.7);
      tone(ctx, d, t + 0.42, 62, 0.25, 'sine', 0.8, 40);
    },
    // Closing: sweep down, then a heavy magnetic thunk.
    fold(ctx, d, t) {
      noise(ctx, d, t, 0.38, 'bandpass', 2400, 280, 0.45, 4);
      tone(ctx, d, t, 240, 0.36, 'sawtooth', 0.05, 80);
      click(ctx, d, t + 0.4, 1);
      tone(ctx, d, t + 0.4, 70, 0.3, 'sine', 0.95, 38);
    },
    tick(ctx, d, t) { click(ctx, d, t, 0.45); },
    // Result sting by score: 3 = fanfare, 0 = sad slide.
    sting(ctx, d, t, score) {
      const notes = { 3: [523.25, 659.25, 783.99, 1046.5], 2: [523.25, 659.25, 783.99, 698.46], 1: [392, 349.23, 311.13], 0: [330, 311, 294, 220] }[score] || [440];
      notes.forEach((f, i) => tone(ctx, d, t + i * 0.1, f, score === 0 ? 0.5 : 0.28, score === 0 ? 'sawtooth' : 'triangle', score === 0 ? 0.12 : 0.22, score === 0 ? f * 0.82 : 0));
      if (score === 3) tone(ctx, d, t + 0.45, 1568, 0.6, 'sine', 0.08);
    },
  };

  // Lo-fi loop: four chords, soft kick/hat, a lazy pentatonic lead. Scheduled a bar at a time.
  const BPM = 76, BEAT = 60 / BPM, BAR = BEAT * 4;
  const CHORDS = [[174.61, 261.63, 329.63, 440], [164.81, 246.94, 329.63, 392], [146.83, 220, 293.66, 349.23], [196, 246.94, 293.66, 392]];
  const LEAD = [523.25, 587.33, 659.25, 783.99, 880];
  function musicBar(ctx, d, t, bar) {
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1400; lp.connect(d);
    CHORDS[bar % 4].forEach((f, i) => {
      const o = ctx.createOscillator(); o.type = i % 2 ? 'sine' : 'triangle'; o.frequency.value = f; o.detune.value = i * 4 - 6;
      const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.05, t + 0.25); g.gain.linearRampToValueAtTime(0.0001, t + BAR - 0.05);
      o.connect(g); g.connect(lp); o.start(t); o.stop(t + BAR);
    });
    tone(ctx, d, t, CHORDS[bar % 4][0] / 2, BEAT * 1.5, 'sine', 0.2);
    for (let b = 0; b < 4; b++) {
      if (b % 2 === 0) tone(ctx, d, t + b * BEAT, 120, 0.16, 'sine', 0.3, 45);
      noise(ctx, d, t + b * BEAT + BEAT / 2, 0.04, 'highpass', 7000, 9000, 0.05, 0.5);
      if (b % 2 === 1) noise(ctx, d, t + b * BEAT, 0.1, 'bandpass', 1800, 1200, 0.12, 1.2);
    }
    const pick = (n) => LEAD[(bar * 3 + n * 2) % LEAD.length];
    [0.5, 1.75, 2.5, 3.25].forEach((beat, n) => { if ((bar + n) % 3 !== 2) tone(ctx, lp, t + beat * BEAT, pick(n), 0.5, 'sine', 0.06); });
  }

  const S = { ctx: null, master: null, sfx: null, music: null, muted: false, musicWanted: true, nextBar: 0, bar: 0, timer: 0 };
  try { S.muted = localStorage.getItem('duo-muted') === '1'; } catch (e) { /* storage blocked */ }

  function ensure() {
    if (!S.ctx) {
      const AC = root.AudioContext || root.webkitAudioContext; if (!AC) return null;
      S.ctx = new AC();
      S.master = S.ctx.createGain(); S.master.gain.value = S.muted ? 0 : 0.9; S.master.connect(S.ctx.destination);
      S.sfx = S.ctx.createGain(); S.sfx.gain.value = 0.8; S.sfx.connect(S.master);
      S.music = S.ctx.createGain(); S.music.gain.value = 0.5; S.music.connect(S.master);
    }
    if (S.ctx.state === 'suspended') S.ctx.resume();
    return S.ctx;
  }
  function pump() {
    if (!S.ctx || S.muted || !S.musicWanted) return;
    while (S.nextBar < S.ctx.currentTime + BAR * 1.5) { musicBar(S.ctx, S.music, Math.max(S.nextBar, S.ctx.currentTime + 0.05), S.bar++); S.nextBar = Math.max(S.nextBar, S.ctx.currentTime) + BAR; }
  }
  function startMusic() {
    if (!S.musicWanted || S.muted || S.timer) return;
    S.nextBar = S.ctx.currentTime + 0.1; pump(); S.timer = setInterval(pump, 800);
  }
  function stopMusic() { clearInterval(S.timer); S.timer = 0; }

  const api = {
    voices, musicBar, BAR,
    /** Call from a tap handler: unlocks audio on iOS and starts the loop once. */
    unlock() { if (ensure()) startMusic(); },
    play(name, arg) { if (S.muted) return; const c = ensure(); if (c) voices[name](c, S.sfx, c.currentTime + 0.02, arg); },
    get muted() { return S.muted; },
    get musicOn() { return S.musicWanted && !S.muted; },
    setMuted(m) {
      S.muted = !!m; try { localStorage.setItem('duo-muted', m ? '1' : '0'); } catch (e) { /* ignore */ }
      if (S.master) S.master.gain.value = m ? 0 : 0.9;
      if (m) stopMusic(); else if (S.ctx) startMusic();
      return S.muted;
    },
    setMusic(on) { S.musicWanted = !!on; if (!on) stopMusic(); else if (S.ctx && !S.muted) startMusic(); return S.musicWanted; },
    /** Offline render for the demo video: events = [{t, name, arg}], music = bool. Returns an AudioBuffer. */
    async renderOffline(events, seconds, music) {
      const oc = new OfflineAudioContext(2, Math.ceil(44100 * seconds), 44100);
      const m = oc.createGain(); m.gain.value = 0.9; m.connect(oc.destination);
      const sfx = oc.createGain(); sfx.gain.value = 0.8; sfx.connect(m);
      const mus = oc.createGain(); mus.gain.value = 0.5; mus.connect(m);
      events.forEach((e) => voices[e.name](oc, sfx, e.t, e.arg));
      if (music) for (let b = 0, t = music.start || 0; t < seconds; b++, t += BAR) musicBar(oc, mus, t, b);
      return oc.startRendering();
    },
  };
  root.DuoSound = api;
})(typeof window !== 'undefined' ? window : globalThis);
