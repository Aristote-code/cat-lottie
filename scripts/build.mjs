// Build the hover animation from the mascot's own vector art.
// node scripts/build.mjs  ->  out/cat_hover.json
//
// The drawing is the SVG itself (split into parts). Motion is hand-keyed at the extremes the
// video shows (bob high/low, each cape flap's peak and trough) with ease-in/out between, and
// the cape flaps by bending its real paths around each shoulder.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { gzipSync } from "node:zlib";

const VID = "/Users/ariga/Documents/video-to-lottie";
const rd = (p) => JSON.parse(readFileSync(p, "utf8"));
const parts = rd("work/parts.json");
const align = rd("work/align.json");
const capefit = rd("work/capefit.json");
const text = rd("work/text.json");
const bob = rd(`${VID}/work/track.json`).frames;
const fx = rd(`${VID}/work/fx.json`);
const FIRST = 70, OP = capefit.frames.length, W = 480, H = 854, FR = 24;

const r1 = (n) => Math.round(n * 10) / 10;
const r2 = (n) => Math.round(n * 100) / 100;
const c01 = (rgb, a = 1) => [...rgb.map((v) => r2(v / 255)), a];
const hex = (h) => [1, 3, 5].map((k) => parseInt(h.slice(k, k + 2), 16));
const st = (k) => ({ a: 0, k });
const EASE = { o: { x: [0.42], y: [0] }, i: { x: [0.58], y: [1] } };
// eased keyframes at chosen frames
const keyed = (frames, values) => ({ a: 1, k: frames.map((t, n) => (n < frames.length - 1 ? { t, s: values[n], ...EASE } : { t, s: values[n] })) });
const tr = (x = {}) => ({ ty: "tr", p: st([0, 0]), a: st([0, 0]), s: st([100, 100]), r: st(0), o: st(100), sk: st(0), sa: st(0), ...x });
let IND = 0;
const layer = (nm, shapes, ks = {}, extra = {}) => ({
  ty: 4, nm, ind: ++IND, ip: 0, op: OP, st: 0, sr: 1, ddd: 0,
  ks: { o: st(100), r: st(0), p: st([0, 0, 0]), a: st([0, 0, 0]), s: st([100, 100, 100]), ...ks }, shapes, ...extra,
});

// ---------- SVG path data -> cubic contours (absolute coordinates) ----------
function parsePath(d) {
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
function toLottie(ct, map = (p) => p) {
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
    v: mv.map((p) => [r1(p[0]), r1(p[1])]),
    i: mi.map((p, k) => [r1(p[0] - mv[k][0]), r1(p[1] - mv[k][1])]),
    o: mo.map((p, k) => [r1(p[0] - mv[k][0]), r1(p[1] - mv[k][1])]),
  };
}

// ---------- cape bend (same model the fit used) ----------
const CX = 676.5;
const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
function bendPoint([x, y], params) {
  if (Math.abs(x - CX) < 60) return [x, y];          // the scrap between the legs stays put
  const side = x < CX ? "left" : "right";
  const wg = capefit.wings[side], { angle, stretch } = params[side];
  const vx = x - wg.anchor[0], vy = y - wg.anchor[1];
  const w = smooth(0.25, 1, Math.hypot(vx, vy) / wg.length);
  const a = (angle * Math.PI / 180) * w, k = 1 + stretch * w;
  return [wg.anchor[0] + (vx * Math.cos(a) - vy * Math.sin(a)) * k, wg.anchor[1] + (vx * Math.sin(a) + vy * Math.cos(a)) * k];
}

// ---------- key frames: the extremes of the measured motion ----------
function smoothSeries(v) { return v.map((_, k) => (v[Math.max(0, k - 1)] + 2 * v[k] + v[Math.min(v.length - 1, k + 1)]) / 4); }
function extremes(v) {
  const keys = [0];
  for (let k = 1; k < v.length - 1; k++) if ((v[k] - v[k - 1]) * (v[k + 1] - v[k]) < 0) keys.push(k);
  keys.push(v.length - 1);
  return keys;
}
const capeSeries = {
  left: { angle: smoothSeries(capefit.frames.map((f) => f.left.angle)), stretch: smoothSeries(capefit.frames.map((f) => f.left.stretch)) },
  right: { angle: smoothSeries(capefit.frames.map((f) => f.right.angle)), stretch: smoothSeries(capefit.frames.map((f) => f.right.stretch)) },
};
// one flap = left and right together; key where their combined swing turns around
const flap = capeSeries.left.angle.map((a, k) => a - capeSeries.right.angle[k]);
const capeKeys = extremes(flap);
const capeParams = (k) => ({
  left: { angle: capeSeries.left.angle[k], stretch: capeSeries.left.stretch[k] },
  right: { angle: capeSeries.right.angle[k], stretch: capeSeries.right.stretch[k] },
});

const bobY = smoothSeries(bob.map((f) => f.ty));
const bobKeys = extremes(bobY);

// ---------- the cat layer: SVG parts, cape paths bent at each key ----------
const groups = [];
for (const name of parts.order) {
  if (name === "shadow" || name === "speedLines") continue;     // drawn in their own layers
  for (const [n, shp] of parts.shapes[name].entries()) {
    const isCape = name === "capeOutline" || (name === "capeBack" && shp.src !== 1);
    const contours = parsePath(shp.d);
    const items = contours.map((ct) => {
      if (!isCape) return { ty: "sh", ks: st(toLottie(ct)) };
      const ks = keyed(capeKeys, capeKeys.map((k) => [toLottie(ct, (p) => bendPoint(p, capeParams(k)))]));
      return { ty: "sh", ks };
    });
    groups.push({ ty: "gr", nm: `${name}-${n}`, it: [...items, { ty: "fl", c: st(c01(hex(shp.fill))), o: st(100), r: 1 }, tr()] });
  }
}
const K = align.scale * 100;
const cat = layer("cat", groups.reverse(), {
  p: keyed(bobKeys, bobKeys.map((k) => [r2(align.tx), r2(align.ty + bobY[k]), 0])),
  s: st([r2(K), r2(K), 100]),
});

// ---------- shadow: soft ellipse that shrinks a touch as the cat rises ----------
const shf = fx.frames.map((f) => f.shadow).filter(Boolean);
const med = (a) => [...a].sort((x, y) => x - y)[a.length >> 1];
const sh = { cx: med(shf.map((s) => s.cx)), cy: med(shf.map((s) => s.cy)), w: med(shf.map((s) => s.w)), h: Math.min(med(shf.map((s) => s.h)), 20), rgb: shf[0].rgb };
const ell = (k, op) => ({ ty: "gr", nm: "shadow", it: [{ ty: "el", p: st([0, 0]), s: st([r1(sh.w * k), r1(sh.h * k)]) }, { ty: "fl", c: st(c01(sh.rgb)), o: st(op), r: 1 }, tr()] });
const shadow = layer("shadow", [ell(0.8, 45), ell(1.08, 40)], {
  p: st([r1(sh.cx), r1(sh.cy), 0]),
  s: keyed(bobKeys, bobKeys.map((k) => { const s = r2(100 + bobY[k] * 0.8); return [s, s, 100]; })),
});

// ---------- sparkles: four-point stars that pop and fade ----------
function star(r) {
  const k = 0.42 * r;
  return { ty: "sh", ks: st({ c: true, v: [[0, -r], [r, 0], [0, r], [-r, 0]], o: [[0, r - k], [-(r - k), 0], [0, -(r - k)], [r - k, 0]], i: [[0, r - k], [-(r - k), 0], [0, -(r - k)], [r - k, 0]] }) };
}
function sparkle(nm, near) {
  const seen = fx.frames.map((f) => f.sparkles.filter((s) => Math.hypot(s.cx - near[0], s.cy - near[1]) < 30).sort((a, b) => b.size - a.size)[0]);
  const on = seen.map(Boolean);
  const first = on.indexOf(true), last = on.lastIndexOf(true);
  const peakAt = seen.reduce((best, s, k) => (s && (!seen[best] || s.size > seen[best].size) ? k : best), first);
  const peak = seen[peakAt].size;
  const pts = seen.filter(Boolean);
  const cx = pts.reduce((a, s) => a + s.cx, 0) / pts.length, cy = pts.reduce((a, s) => a + s.cy, 0) / pts.length;
  const t0 = Math.max(0, first - 1), t2 = Math.min(OP - 1, last + 1);
  return layer(nm, [{ ty: "gr", nm: "star", it: [star(peak * 0.62), { ty: "fl", c: st([1, 1, 1, 1]), o: st(100), r: 1 }, tr()] }], {
    p: st([r1(cx), r1(cy), 0]),
    s: keyed([t0, peakAt, t2], [[0, 0, 100], [100, 100, 100], [0, 0, 100]]),
    r: keyed([t0, t2], [[-20], [25]]),
  });
}

// ---------- logo: real type, fading in on the measured timing ----------
function fade(vals) {
  let start = 0;
  vals.forEach((v, k) => { if (v < 0.1) start = k; });
  const full = vals.findIndex((v, k) => k > start && v >= 0.97);
  return start >= full ? st(100) : keyed([start, full], [[0], [100]]);
}
const textLayer = (nm, t, op) => layer(nm, [{ ty: "gr", nm, it: [...parsePath(t.d).map((ct) => ({ ty: "sh", ks: st(toLottie(ct)) })), { ty: "fl", c: st(c01(t.rgb)), o: st(100), r: 1 }, tr()] }], { o: op });
const title = textLayer("title", text.title, fade(fx.frames.map((f) => f.title_opacity)));
const tag = textLayer("tagline", text.tag, fade(fx.frames.map((f) => f.tag_opacity)));

// ---------- background and the video's rounded corners ----------
const bg = fx.background;
const grad = [0, ...bg.top.map((v) => r2(v / 255)), 0.5, ...bg.mid.map((v) => r2(v / 255)), 1, ...bg.bottom.map((v) => r2(v / 255))];
const background = layer("background", [{ ty: "gr", nm: "bg", it: [
  { ty: "rc", p: st([W / 2, H / 2]), s: st([W, H]), r: st(0) },
  { ty: "gf", o: st(100), r: 1, t: 1, s: st([W / 2, 0]), e: st([W / 2, H]), g: { p: 3, k: st(grad) } }, tr(),
] }]);
const corners = layer("corners", [{ ty: "gr", nm: "corners", it: [
  { ty: "rc", p: st([W / 2, H / 2]), s: st([W + 4, H + 4]), r: st(0) },
  { ty: "rc", p: st([W / 2, H / 2]), s: st([W, H]), r: st(17) },
  { ty: "fl", c: st([0, 0, 0, 1]), o: st(100), r: 2 }, tr(),
] }]);

const json = { v: "5.7.0", fr: FR, ip: 0, op: OP, w: W, h: H, nm: "Twist cat - hover", assets: [],
  layers: [corners, tag, title, sparkle("sparkle-left", [136, 318]), sparkle("sparkle-right", [377, 413]), cat, shadow, background] };
mkdirSync("out", { recursive: true });
const out = JSON.stringify(json);
writeFileSync("out/cat_hover.json", out);
console.log(`cape keys at frames ${capeKeys.join(",")}; bob keys ${bobKeys.join(",")}`);
console.log(`${(out.length / 1024).toFixed(1)} KB raw, ${(gzipSync(out).length / 1024).toFixed(1)} KB gzipped`);
