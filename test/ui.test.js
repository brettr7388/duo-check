import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (f) => readFileSync(new URL('../public/' + f, import.meta.url), 'utf8');
const css = read('style.css');
const html = read('index.html');
const js = read('app.js');

test('device layers clip themselves to the rounded shape', () => {
  const face = css.match(/^\.face \{[^}]*\}/ms)?.[0] ?? '';
  assert.match(face, /overflow:\s*hidden/);
  assert.match(face, /clip-path:\s*inset\(0 round var\(--fr/);
  const screen = css.match(/^\.screen \{[^}]*\}/ms)?.[0] ?? '';
  assert.match(screen, /overflow:\s*hidden/);
  assert.match(screen, /clip-path:\s*inset\(0 round var\(--sr\)\)/);
  assert.match(css, /\.shade[^{]*\{[^}]*border-radius:\s*inherit/);
});

test('leaf A morphs its hinge corners instead of popping square corners out of the folded phone', () => {
  assert.match(css, /\.leaf\.a \.face \{[^}]*transition:[^}]*clip-path/);
  assert.match(css, /\.stage:not\(\[data-pose="folded"\]\) \.leaf\.a \.face \{ --fr: 30px 4px 4px 30px/);
  assert.match(css, /\.leaf\.a \{ opacity: 0; transition: opacity \.2s calc\(var\(--dur\) \* \.72\)/);
});

test('shade, island and crease live inside the clipped faces', () => {
  assert.match(html, /<div class="screen"><img id="img-b"[^>]*><i class="shade"><\/i><\/div>/);
  assert.match(html, /<div class="screen"><img id="img-f"[^>]*><i class="shade"><\/i><\/div>/);
  assert.match(html, /<div class="face back"><i class="island"><\/i>/);
  assert.match(css, /\.leaf\.b \.back \{ padding-top: calc\(var\(--b\) \+ 17px\)/);
});

test('landing shows two sample results above the fold, with real inline thumbnails', () => {
  const samples = html.match(/<button type="button" class="sample (bad|good)"[^>]*data-url="[^"]+"/g) ?? [];
  assert.equal(samples.length, 2);
  assert.equal((html.match(/src="data:image\/jpeg;base64,/g) ?? []).length, 2);
  assert.ok(html.indexOf('id="samples"') < html.indexOf('id="stage"'));
});

test('share card prints the real host, never a hard-coded localhost', () => {
  assert.match(js, /location\.host/);
  assert.doesNotMatch(js + html + css, /localhost/);
  assert.doesNotMatch(js + html, /cards\.png/);
});

test('portrait crease is subtle and cannot cut text', () => {
  const m = css.match(/^\.pcrease \{[^}]*\}/m)?.[0] ?? '';
  const op = Number(m.match(/opacity:\s*([\d.]+)/)?.[1]);
  assert.ok(op > 0 && op <= 0.6, 'crease opacity is low');
  assert.doesNotMatch(m, /mix-blend-mode:\s*multiply/);
});
