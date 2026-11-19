// Shared Lottie helpers: SVG path data -> Lottie shapes, keyframe and layer builders.
export const r1 = (n) => Math.round(n * 10) / 10;
export const r2 = (n) => Math.round(n * 100) / 100;
export const c01 = (rgb, a = 1) => [...rgb.map((v) => r2(v / 255)), a];
export const hex = (h) => [1, 3, 5].map((k) => parseInt(h.slice(k, k + 2), 16));
export const st = (k) => ({ a: 0, k });
export const EASE = { o: { x: [0.42], y: [0] }, i: { x: [0.58], y: [1] } };
export const LIN = { o: { x: [0], y: [0] }, i: { x: [1], y: [1] } };
// keyframes at chosen frames, eased (or linear) between them
export const keyed = (frames, values, ease = EASE) => ({ a: 1, k: frames.map((t, n) => (n < frames.length - 1 ? { t, s: values[n], ...ease } : { t, s: values[n] })) });
export const held = (frames, values) => ({ a: 1, k: frames.map((t, n) => ({ t, s: values[n], h: 1 })) });
export const tr = (x = {}) => ({ ty: "tr", p: st([0, 0]), a: st([0, 0]), s: st([100, 100]), r: st(0), o: st(100), sk: st(0), sa: st(0), ...x });

export function parsePath(d) {
  const tok = d.match(/[MLHVCQZmlhvcqz]|-?(?:\d+\.?\d*|\.\d+)(?:e-?\d+)?/g);
  const contours = [];
  let cur = null, i = 0, x = 0, y = 0, cmd = null;
  const n = () => +tok[i++];
  const isCmd = (t) => /^[A-Za-z]$/.test(t);
  while (i < tok.length) {
    if (isCmd(tok[i])) cmd = tok[i++].toUpperCase();
    else if (cmd === "M") cmd = "L";            // extra pairs after a move are line-tos
    if (cmd === "M") { x = n(); y = n(); cur = { pts: [[x, y]], segs: [], closed: false }; contours.push(cur); }
    else if (cmd === "L") { x = n(); y = n(); cur.segs.push([[x, y], [x, y], [x, y], "L"]); }
    else if (cmd === "H") { x = n(); cur.segs.push([[x, y], [x, y], [x, y], "L"]); }
    else if (cmd === "V") { y = n(); cur.segs.push([[x, y], [x, y], [x, y], "L"]); }
    else if (cmd === "C") { const a = [n(), n()], b = [n(), n()]; x = n(); y = n(); cur.segs.push([a, b, [x, y], "C"]); }
    else if (cmd === "Q") {
      const q = [n(), n()], p0 = [x, y]; x = n(); y = n();
      cur.segs.push([[p0[0] + (2 / 3) * (q[0] - p0[0]), p0[1] + (2 / 3) * (q[1] - p0[1])], [x + (2 / 3) * (q[0] - x), y + (2 / 3) * (q[1] - y)], [x, y], "C"]);
    } else if (cmd === "Z") {
      cur.closed = true; x = cur.pts[0][0]; y = cur.pts[0][1];
      // a new subpath may start without M after Z: continue from the start point
      if (i < tok.length && !isCmd(tok[i])) { cur = { pts: [[x, y]], segs: [], closed: false }; contours.push(cur); cmd = "L"; }
    }
  }
  return contours.filter((c) => c.segs.length);
}
// contour + point mapping -> Lottie shape value
export function toLottie(ct, map = (p) => p, rnd = r1) {
  const v = [ct.pts[0]], i = [[0, 0]], o = [[0, 0]];
  const absIn = [ct.pts[0]], absOut = [];
  for (const [c1, c2, p, kind] of ct.segs) {
    absOut.push(kind === "C" ? c1 : v[v.length - 1]);
    v.push(p); absIn.push(kind === "C" ? c2 : p);
  }
  absOut.push(v[v.length - 1]);
  // closing: drop a duplicated end point
  let N = v.length;
  if (ct.closed && N > 1 && Math.hypot(v[N - 1][0] - v[0][0], v[N - 1][1] - v[0][1]) < 1e-6) {
    absIn[0] = absIn[N - 1]; v.pop(); absIn.pop(); absOut.pop(); N--;
  }
  const mv = v.map(map), mi = absIn.map(map), mo = absOut.map(map);
  return {
    c: ct.closed,
    v: mv.map((p) => [rnd(p[0]), rnd(p[1])]),
    i: mi.map((p, k) => [rnd(p[0] - mv[k][0]), rnd(p[1] - mv[k][1])]),
    o: mo.map((p, k) => [rnd(p[0] - mv[k][0]), rnd(p[1] - mv[k][1])]),
  };
}


// Drop keys that the player would reproduce anyway: a key goes if linear interpolation
// between its kept neighbours lands within `tol` of it (values are flattened number arrays).
export function thinKeys(frames, values, tol, flat = (v) => v.flat(Infinity)) {
  const keep = [0];
  for (let k = 1; k < frames.length - 1; k++) {
    const a = keep[keep.length - 1], b = k + 1;
    const fa = flat(values[a]), fb = flat(values[b]);
    let ok = true;
    for (let j = a + 1; j <= k && ok; j++) {
      const t = (frames[j] - frames[a]) / (frames[b] - frames[a]);
      const fj = flat(values[j]);
      for (let n = 0; n < fj.length; n++) if (Math.abs(fa[n] + (fb[n] - fa[n]) * t - fj[n]) > tol) { ok = false; break; }
    }
    if (!ok) keep.push(k);
  }
  keep.push(frames.length - 1);
  return { frames: keep.map((k) => frames[k]), values: keep.map((k) => values[k]) };
}
