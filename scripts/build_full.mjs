// Build the full 4-second animation from the mascot's vector art.
// node scripts/build_full.mjs  ->  out/cat_full.json
//
// Drawings: the source SVG (flying pose) plus the hand-drawn standing and sitting poses.
// Motion: each pose follows the video's tracked movement (smoothed, so it reads as clean
// animation rather than AI jitter); the cape is warped onto the video's shapes during the
// climb and bent for the hover flutter; clouds, puffs, speed lines and sparkles are drawn
// as vector shapes driven by their measured size and position.
import { readFileSync, writeFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { CK } from "./lib.mjs";
import { r1, r2, c01, hex, st, EASE, LIN, keyed, held, tr, parsePath, toLottie, thinKeys } from "./lottie_lib.mjs";
const r0 = (n) => Math.round(n);   // SVG units are ~4x finer than screen pixels

const VID = "/Users/ariga/Documents/video-to-lottie";
const rd = (p) => JSON.parse(readFileSync(p, "utf8"));
const parts = rd("work/parts.json");
const align = rd("work/align.json");
const capefit = rd("work/capefit.json");          // hover flutter (frames 70-97)
const tps = rd("work/cape_tps.json");             // climb cape keys
const text = rd("work/text.json");
const fxt = rd("work/fx_tracks.json");
const track = rd(`${VID}/work/track_full.json`);
const fxFull = rd(`${VID}/work/fx_full.json`);
const fxPilot = rd(`${VID}/work/fx.json`);
const W = 480, H = 854, FR = 24, OP = track.length;
const T0 = (frame) => frame - 1;                  // video frame number -> Lottie time

let IND = 0;
const layer = (nm, shapes, ks = {}, ip = 0, op = OP) => ({
  ty: 4, nm, ind: ++IND, ip, op, st: 0, sr: 1, ddd: 0,
  ks: { o: st(100), r: st(0), p: st([0, 0, 0]), a: st([0, 0, 0]), s: st([100, 100, 100]), ...ks }, shapes,
});
const fillGroup = (nm, shapeItems, rgb, opacity = 100) => ({ ty: "gr", nm, it: [...shapeItems, { ty: "fl", c: st(c01(rgb)), o: st(opacity), r: 1 }, tr()] });
const pathItems = (d, map, rnd = r1) => parsePath(d).map((ct) => ({ ty: "sh", ks: st(toLottie(ct, map, rnd)) }));

// ---------- pose placement: SVG units -> frame, per frame ----------
const placeRef = {
  fly: { K: align.scale, t: [align.tx, align.ty] },
  stand: (() => { const g = rd("work/guide_stand.json"); return { K: g.scale, t: [g.tx, g.ty] }; })(),
  sit: (() => { const g = rd("work/guide_sit.json"); return { K: g.scale, t: [g.tx, g.ty] }; })(),
};
function poseTransforms(pose) {
  const raw = track.map((r) => {
    if (!r.present || r.pose !== pose) return null;
    const [[a, b, tx], [c, d, ty]] = r.affine;
    const { K, t } = placeRef[pose];
    const p = [a * t[0] + b * t[1] + tx, c * t[0] + d * t[1] + ty];
    const m = [K * a, K * b, K * c, K * d];
    const sx = Math.hypot(m[0], m[2]);
    return { p, rot: (Math.atan2(m[2], m[0]) * 180) / Math.PI, sx, sy: (m[0] * m[3] - m[1] * m[2]) / sx };
  });
  // smooth within each run of frames (removes the source's frame-to-frame jitter)
  const w = [1, 4, 6, 4, 1];
  return raw.map((v, i) => {
    if (!v) return null;
    let acc = { p: [0, 0], rot: 0, sx: 0, sy: 0 }, tot = 0;
    for (let k = -2; k <= 2; k++) {
      const u = raw[i + k];
      if (!u) continue;
      const wt = w[k + 2];
      acc = { p: [acc.p[0] + u.p[0] * wt, acc.p[1] + u.p[1] * wt], rot: acc.rot + u.rot * wt, sx: acc.sx + u.sx * wt, sy: acc.sy + u.sy * wt };
      tot += wt;
    }
    return { p: acc.p.map((x) => x / tot), rot: acc.rot / tot, sx: acc.sx / tot, sy: acc.sy / tot };
  });
}
function poseLayer(name, groups, pose) {
  const xf = poseTransforms(pose);
  const on = xf.map((v, t) => (v ? t : -1)).filter((t) => t >= 0);
  const thin = (vals, tol) => { const th = thinKeys(on, vals, tol); return keyed(th.frames, th.values, LIN); };
  // visible only on its own frames: one opacity switch on, one off
  const ip = on[0], op = on[on.length - 1] + 1;
  return layer(name, groups, {
    p: thin(on.map((t) => [r1(xf[t].p[0]), r1(xf[t].p[1]), 0]), 0.25),
    r: thin(on.map((t) => [r2(xf[t].rot)]), 0.1),
    s: thin(on.map((t) => [r2(xf[t].sx * 100), r2(xf[t].sy * 100), 100]), 0.15),
  }, ip, op);
}

// ---------- the drawn standing / sitting poses ----------
const drawnGroups = (file) => rd(file).map((x, k) => fillGroup(`part-${k}`, pathItems(x.d, undefined, r0), hex(x.fill))).reverse();

// ---------- flying pose: source parts with an animated cape ----------
const CX = 676.5;
const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
function bendPoint([x, y], params) {
  if (Math.abs(x - CX) < 60) return [x, y];
  const side = x < CX ? "left" : "right";
  const wg = capefit.wings[side], { angle, stretch } = params[side];
  const vx = x - wg.anchor[0], vy = y - wg.anchor[1];
  const w = smooth(0.25, 1, Math.hypot(vx, vy) / wg.length);
  const a = (angle * Math.PI) / 180 * w, k = 1 + stretch * w;
  return [wg.anchor[0] + (vx * Math.cos(a) - vy * Math.sin(a)) * k, wg.anchor[1] + (vx * Math.sin(a) + vy * Math.cos(a)) * k];
}
function tpsPoint([x, y], t) {
  if (Math.abs(x - CX) < 60 && y > 860) return [x, y];          // the scrap between the legs stays
  let ox = t.a[0][0] + x * t.a[1][0] + y * t.a[2][0];
  let oy = t.a[0][1] + x * t.a[1][1] + y * t.a[2][1];
  for (let i = 0; i < t.ctrl.length; i++) {
    const d = Math.hypot(x - t.ctrl[i][0], y - t.ctrl[i][1]);
    const u = d > 0 ? d * d * Math.log(d) : 0;
    ox += u * t.w[i][0]; oy += u * t.w[i][1];
  }
  return [ox, oy];
}
// cape keys: warped shapes through the climb, bends at each flap of the hover
const smoothSeries = (v) => v.map((_, k) => (v[Math.max(0, k - 1)] + 2 * v[k] + v[Math.min(v.length - 1, k + 1)]) / 4);
const series = (side, key) => smoothSeries(capefit.frames.map((f) => f[side][key]));
const S = { la: series("left", "angle"), ls: series("left", "stretch"), ra: series("right", "angle"), rs: series("right", "stretch") };
const flap = S.la.map((a, k) => a - S.ra[k]);
const hoverKeys = [0];
for (let k = 1; k < flap.length - 1; k++) if ((flap[k] - flap[k - 1]) * (flap[k + 1] - flap[k]) < 0) hoverKeys.push(k);
hoverKeys.push(flap.length - 1);
const capeKeys = [
  ...Object.keys(tps).map(Number).sort((a, b) => a - b).map((f) => ({ t: T0(f), map: (p) => tpsPoint(p, tps[f]) })),
  ...hoverKeys.map((k) => ({ t: T0(70 + k), map: (p) => bendPoint(p, { left: { angle: S.la[k], stretch: S.ls[k] }, right: { angle: S.ra[k], stretch: S.rs[k] } }) })),
];
const flyGroups = [];
for (const name of parts.order) {
  if (name === "shadow" || name === "speedLines") continue;
  for (const [n, shp] of parts.shapes[name].entries()) {
    const isCape = name === "capeOutline" || (name === "capeBack" && shp.src !== 1);
    const items = parsePath(shp.d).map((ct) => {
      if (!isCape) return { ty: "sh", ks: st(toLottie(ct, undefined, r0)) };
      // cape shape keys, thinned where the morph would reproduce them within 3 units (~0.7 px)
      const shapes = capeKeys.map((k) => [toLottie(ct, k.map, r0)]);
      const th = thinKeys(capeKeys.map((k) => k.t), shapes, 3, (v) => [...v[0].v.flat(), ...v[0].i.flat(), ...v[0].o.flat()]);
      return { ty: "sh", ks: keyed(th.frames, th.values) };
    });
    flyGroups.push(fillGroup(`${name}-${n}`, items, hex(shp.fill)));
  }
}
flyGroups.reverse();

// ---------- clouds: one puffy design in the video's style, driven by each measured cloud ----------
const P = (d) => CK.Path.MakeFromSVGString(d);
const U = (a, b) => CK.Path.MakeFromOp(a, b, CK.PathOp.Union);
const Dif = (a, b) => CK.Path.MakeFromOp(a, b, CK.PathOp.Difference);
const pb = (fn) => { const b = new CK.PathBuilder(); fn(b); return b.detachAndDelete(); };
const oval = (cx, cy, rx, ry) => pb((b) => b.addOval(CK.LTRBRect(cx - rx, cy - ry, cx + rx, cy + ry)));
const shift = (p, dx, dy) => pb((b) => { b.addPath(p); b.transform(CK.Matrix.translated(dx, dy)); });
const grow = (p, r) => U(p, p.makeStroked({ width: 2 * r, join: CK.StrokeJoin.Round }));
const CLOUD = {
  big: { w: 200, h: 120, bumps: [[-58, 12, 42], [-18, -16, 50], [34, -10, 45], [70, 16, 34]], base: [0, 30, 96, 28], hi: [[-34, -38, 16, 6], [16, -42, 12, 5]] },
  small: { w: 110, h: 70, bumps: [[-24, 2, 30], [16, -6, 34]], base: [0, 16, 52, 18], hi: [[-26, -16, 9, 4]] },
};
const CC = { rim: [238, 228, 251], body: [220, 201, 246], under: [203, 179, 240], hi: [248, 243, 254] };
function cloudShapes(kind) {
  const c = CLOUD[kind];
  let body = oval(c.base[0], c.base[1], c.base[2], c.base[3]);
  for (const [x, y, r] of c.bumps) body = U(body, oval(x, y, r, r));
  const under = Dif(body, shift(body, 0, -12));
  const items = [
    fillGroup("rim", pathItems(grow(body, 4).toSVGString()), CC.rim),
    fillGroup("body", pathItems(body.toSVGString()), CC.body),
    fillGroup("under", pathItems(under.toSVGString()), CC.under),
    ...c.hi.map(([x, y, rx, ry], k) => fillGroup(`hi${k}`, pathItems(oval(x, y, rx, ry).toSVGString()), CC.hi)),
  ];
  return items.reverse();
}
// each cloud design is drawn once as a precomp and reused by every cloud layer
const cloudAssets = Object.keys(CLOUD).map((kind) => {
  const c = CLOUD[kind], w = c.w + 40, h = c.h + 40;
  return { id: `cloud_${kind}`, w, h, layers: [{
    ty: 4, nm: kind, ind: 1, ip: 0, op: OP, st: 0, sr: 1, ddd: 0,
    ks: { o: st(100), r: st(0), p: st([w / 2, h / 2, 0]), a: st([0, 0, 0]), s: st([100, 100, 100]) },
    shapes: cloudShapes(kind),
  }] };
});
function cloudLayer(nm, keys, kind) {
  const c = CLOUD[kind];
  const pw = c.w + 40, ph = c.h + 40;
  const f0 = keys[0].frame, f1 = keys[keys.length - 1].frame;
  const ts = keys.map((k) => T0(k.frame));
  const th = (vals, tol) => { const r = thinKeys(ts, vals, tol); return keyed(r.frames, r.values, LIN); };
  return {
    ...layer(nm, undefined, {
      a: st([pw / 2, ph / 2, 0]),
      p: th(keys.map((k) => { const s = k.w / c.w; return [r1(k.cx), r1(k.cy + k.h / 2 - (c.h / 2) * s), 0]; }), 0.6),
      s: th(keys.map((k) => { const s = r1((100 * k.w) / c.w); return [s, s, 100]; }), 1.5),
    }, T0(f0), T0(f1) + 1),
    ty: 0, refId: `cloud_${kind}`, w: pw, h: ph,
  };
}
const cloudLayers = [];
const mainClouds = fxt.tracks.filter((t) => t.kind === "cloud" && t.keys[0].frame === 37 && Math.max(...t.keys.map((k) => k.area)) > 15000);
const burst = { cx: 237, cy: 735, w: 60, h: 36 };
for (const [n, t] of fxt.tracks.entries()) {
  const first = t.keys[0].frame, big = Math.max(...t.keys.map((k) => k.area));
  if (first >= 70) continue;                               // hover sparkles, drawn below
  if (first < 37 && big > 30000) continue;                 // the merged burst blob: drawn as the three main clouds
  let keys = t.keys;
  if (mainClouds.includes(t)) {
    // the burst: grow each main cloud out of the launch point over frames 31-36
    const k37 = t.keys[0];
    const pre = [31, 32, 33, 34, 35, 36].map((f) => {
      const e = EASE_OUT((f - 31) / 6);
      return { frame: f, cx: burst.cx + (k37.cx - burst.cx) * e, cy: burst.cy + (k37.cy - burst.cy) * e, w: burst.w + (k37.w - burst.w) * e, h: burst.h + (k37.h - burst.h) * e };
    });
    keys = [...pre, ...keys];
  }
  cloudLayers.push(cloudLayer(`cloud-${n}`, keys, big > 3000 ? "big" : "small"));
}
function EASE_OUT(x) { return 1 - Math.pow(1 - x, 3); }

// ---------- sparkles: four-point stars ----------
function star(r) {
  const k = 0.42 * r;
  return { ty: "sh", ks: st({ c: true, v: [[0, -r], [r, 0], [0, r], [-r, 0]], o: [[0, r - k], [-(r - k), 0], [0, -(r - k)], [r - k, 0]], i: [[0, r - k], [-(r - k), 0], [0, -(r - k)], [r - k, 0]] }) };
}
const sparkleLayers = fxt.tracks.filter((t) => t.keys[0].frame >= 70).map((t, n) => {
  const peak = Math.max(...t.keys.map((k) => k.w));
  const cx = t.keys.reduce((a, k) => a + k.cx, 0) / t.keys.length, cy = t.keys.reduce((a, k) => a + k.cy, 0) / t.keys.length;
  const f0 = t.keys[0].frame - 1, f1 = t.keys[t.keys.length - 1].frame + 1;
  const ts = [T0(f0), ...t.keys.map((k) => T0(k.frame)), T0(f1)];
  const sc = [0, ...t.keys.map((k) => r1((100 * k.w) / peak)), 0];
  return layer(`sparkle-${n}`, [fillGroup("star", [star(peak * 0.55)], [255, 255, 255])], {
    p: st([r1(cx), r1(cy), 0]),
    s: keyed(ts, sc.map((v) => [v, v, 100]), LIN),
  }, T0(f0), T0(f1) + 1);
});

// ---------- speed lines: rounded strokes where the video draws them ----------
const lineLayers = [];
for (const fr of fxt.frames) {
  const lines = fr.items.filter((it) => it.kind === "line");
  if (!lines.length) continue;
  const shapes = lines.map((l, k) => fillGroup(`line${k}`, [{ ty: "rc", p: st([r1(l.x + l.w / 2), r1(l.y + l.h / 2)]), s: st([Math.max(4, l.w), l.h]), r: st(Math.max(2, l.w / 2)) }], [201, 179, 242], 60));
  lineLayers.push(layer(`lines-${fr.frame}`, shapes, {}, T0(fr.frame), T0(fr.frame) + 1));
}

// ---------- shadow on the ground ----------
const sh = fxFull.frames.map((f) => (f.shadow && f.shadow.cy > 540 && f.shadow.w > 40 ? f.shadow : null));
let shLast = sh.find(Boolean);
const shVals = sh.map((s) => (s ? (shLast = s) : shLast));
const shH = (s) => Math.min(s.h, s.w * 0.2);
const shadow = layer("shadow", [{ ty: "gr", nm: "shadow", it: [
  { ty: "el", p: st([0, 0]), s: keyed(shVals.map((_, t) => t), shVals.map((s) => [r1(s.w), r1(shH(s))]), LIN) },
  { ty: "fl", c: st(c01(shVals[0].rgb)), o: st(70), r: 1 }, tr(),
] }], {
  p: keyed(shVals.map((_, t) => t), shVals.map((s) => [r1(s.cx), r1(s.cy), 0]), LIN),
  o: held(sh.map((_, t) => t), sh.map((s) => [s ? 100 : 0])),
});

// ---------- logo: real type with the measured fade ----------
function fade(vals) {
  let start = 0;
  vals.forEach((v, k) => { if (v < 0.1) start = k; });
  const full = vals.findIndex((v, k) => k > start && v >= 0.97);
  return start >= full ? st(100) : keyed([start, full], [[0], [100]]);
}
const textLayer = (nm, t, op) => layer(nm, [fillGroup(nm, pathItems(t.d), t.rgb)], { o: op });
const title = textLayer("title", text.title, fade(fxFull.frames.map((f) => f.title_opacity)));
const tag = textLayer("tagline", text.tag, fade(fxFull.frames.map((f) => f.tag_opacity)));

// ---------- background and the video's rounded corners ----------
const bg = fxPilot.background;
const grad = [0, ...bg.top.map((v) => r2(v / 255)), 0.5, ...bg.mid.map((v) => r2(v / 255)), 1, ...bg.bottom.map((v) => r2(v / 255))];
const background = layer("background", [{ ty: "gr", nm: "bg", it: [
  { ty: "rc", p: st([W / 2, H / 2]), s: st([W, H]), r: st(0) },
  { ty: "gf", o: st(100), r: 1, t: 1, s: st([W / 2, 0]), e: st([W / 2, H]), g: { p: 3, k: st(grad) } }, tr(),
] }]);
const corners = layer("corners", [{ ty: "gr", nm: "corners", it: [
  { ty: "rc", p: st([W / 2, H / 2]), s: st([W + 4, H + 4]), r: st(0) },
  { ty: "rc", p: st([W / 2, H / 2]), s: st([W, H]), r: st(fxFull.corner_radius) },
  { ty: "fl", c: st([0, 0, 0, 1]), o: st(100), r: 2 }, tr(),
] }]);

const json = {
  v: "5.7.0", fr: FR, ip: 0, op: OP, w: W, h: H, nm: "Twist cat", assets: cloudAssets,
  layers: [
    corners, tag, title, ...sparkleLayers, ...lineLayers, ...cloudLayers,
    poseLayer("cat-fly", flyGroups, "fly"), poseLayer("cat-sit", drawnGroups("work/pose_sit.json"), "sit"), poseLayer("cat-stand", drawnGroups("work/pose_stand.json"), "stand"),
    shadow, background,
  ],
};
const out = JSON.stringify(json);
writeFileSync("out/cat_full.json", out);
console.log(`layers ${json.layers.length} (clouds ${cloudLayers.length}, lines ${lineLayers.length}, sparkles ${sparkleLayers.length}); cape keys ${capeKeys.length}`);
console.log(`${(out.length / 1024).toFixed(1)} KB raw, ${(gzipSync(out).length / 1024).toFixed(1)} KB gzipped`);
