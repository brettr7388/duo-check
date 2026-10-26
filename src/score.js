// Scoring. Three real checks, one point each. No fake percentages.
export const POSES = {
  folded: { label: 'Folded', w: 382, h: 580 },
  landscape: { label: 'Unfolded', w: 951, h: 585 },
  portrait: { label: 'Unfolded, portrait', w: 669, h: 867 },
};
export const DPR = 3;
const TOL = 1; // px of rounding slack

/** layoutWidth: widest thing the page laid out (scrollWidth). Fits when it is not wider than the pose. */
export function overflows(layoutWidth, poseWidth) {
  return layoutWidth > poseWidth + TOL;
}

/**
 * m = { folded: {layoutWidth}, landscape: {layoutWidth}, portrait?: {layoutWidth}, viewportMeta: boolean }
 * Returns { score, max, checks: [{id,label,pass,detail}], verdict }
 */
export function scoreResult(m) {
  const checks = [
    { id: 'folded', label: `Folded (${POSES.folded.w}px): no sideways scroll`, pass: !overflows(m.folded.layoutWidth, POSES.folded.w), detail: `page is ${m.folded.layoutWidth}px wide` },
    { id: 'landscape', label: `Unfolded (${POSES.landscape.w}px): no sideways scroll`, pass: !overflows(m.landscape.layoutWidth, POSES.landscape.w), detail: `page is ${m.landscape.layoutWidth}px wide` },
    { id: 'viewport', label: 'Has a viewport meta tag', pass: !!m.viewportMeta, detail: m.viewportMeta ? 'found' : 'missing: Safari lays out at 980px and shrinks it' },
  ];
  const score = checks.filter((c) => c.pass).length;
  return { score, max: 3, checks, verdict: verdictFor(score) };
}

export function verdictFor(score) {
  return [
    { title: 'Absolute pancake', line: 'It broke on every front. Fold it back up and pretend you never saw this.' },
    { title: 'Bro shipped on a Tuesday', line: 'Two out of three things are on fire. The Duo is not impressed.' },
    { title: 'So close it hurts', line: 'One sideways-scroll crime away from perfect. Fix it and the fold is yours.' },
    { title: 'Duo certified', line: 'It folds, it unfolds, it slaps. Your CSS has seen things and stayed calm.' },
  ][Math.max(0, Math.min(3, score))];
}
