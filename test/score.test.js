import test from 'node:test';
import assert from 'node:assert/strict';
import { scoreResult, overflows, verdictFor, POSES, DPR } from '../src/score.js';

test('poses are WebKit published sizes at 3x', () => {
  assert.deepEqual([POSES.folded.w, POSES.folded.h], [382, 580]);
  assert.deepEqual([POSES.landscape.w, POSES.landscape.h], [951, 585]);
  assert.deepEqual([POSES.portrait.w, POSES.portrait.h], [669, 867]);
  assert.equal(DPR, 3);
});

test('overflow is wider-than-the-pose, with 1px rounding slack', () => {
  assert.equal(overflows(382, 382), false); assert.equal(overflows(383, 382), false); assert.equal(overflows(384, 382), true);
  assert.equal(overflows(980, 382), true);
});

test('3/3 when nothing overflows and the viewport tag exists', () => {
  const r = scoreResult({ folded: { layoutWidth: 382 }, landscape: { layoutWidth: 951 }, viewportMeta: true });
  assert.equal(r.score, 3); assert.equal(r.max, 3); assert.ok(r.checks.every((c) => c.pass));
  assert.equal(r.verdict.title, 'Duo certified');
});

test('each check costs exactly one point', () => {
  assert.equal(scoreResult({ folded: { layoutWidth: 600 }, landscape: { layoutWidth: 951 }, viewportMeta: true }).score, 2);
  assert.equal(scoreResult({ folded: { layoutWidth: 382 }, landscape: { layoutWidth: 1200 }, viewportMeta: true }).score, 2);
  assert.equal(scoreResult({ folded: { layoutWidth: 382 }, landscape: { layoutWidth: 951 }, viewportMeta: false }).score, 2);
  const r = scoreResult({ folded: { layoutWidth: 1120 }, landscape: { layoutWidth: 1120 }, viewportMeta: true });
  assert.equal(r.score, 1); assert.deepEqual(r.checks.map((c) => c.pass), [false, false, true]);
});

test('worst case is 0/3 and verdicts clamp', () => {
  const r = scoreResult({ folded: { layoutWidth: 980 }, landscape: { layoutWidth: 1400 }, viewportMeta: false });
  assert.equal(r.score, 0); assert.equal(r.verdict.title, 'Absolute pancake');
  assert.equal(verdictFor(-5).title, 'Absolute pancake'); assert.equal(verdictFor(9).title, 'Duo certified');
});
