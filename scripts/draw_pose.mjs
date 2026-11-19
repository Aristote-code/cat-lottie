// Draw the standing and sitting poses in the mascot's own style, reusing its head, face,
// collar and medallion paths and drawing new limbs, torso and cape with the same recipe the
// source uses: a darker base, a lighter fill offset toward the light, toe lines, and one
// thick dark outline grown around every part.
//
// node scripts/draw_pose.mjs  ->  work/pose_stand.json, work/pose_sit.json (+ preview and onion-skin PNGs)
import { CK, readSvgPaths, renderPng } from "./lib.mjs";
import { readFileSync, writeFileSync } from "node:fs";

const src = readSvgPaths("art/mascot_fly.svg");
const C = { ink: "#260554", light: "#D58CF4", shade: "#B772E9", red: "#FB282B", redMid: "#E62329", redDark: "#C31A23", white: "#FEFEFE", tooth: "#E1E0E1" };
const T = 22;          // outline thickness, as in the source
const CX = 683;        // head centre line

// ---------- geometry helpers ----------
const op = (a, b, k) => CK.Path.MakeFromOp(a, b, k);
const U = (a, b) => op(a, b, CK.PathOp.Union);
const I = (a, b) => op(a, b, CK.PathOp.Intersect);
const D = (a, b) => op(a, b, CK.PathOp.Difference);
const unionAll = (ps) => ps.reduce((a, b) => (a ? U(a, b) : b), null);
// paths are immutable in this Skia build: build with a PathBuilder, then snapshot
const build = (fn) => { const b = new CK.PathBuilder(); fn(b); return b.detachAndDelete(); };
const xform = (p, m) => build((b) => { b.addPath(p); b.transform(m); });
function ellipse(cx, cy, rx, ry, rot = 0) {
  const p = build((b) => b.addOval(CK.LTRBRect(cx - rx, cy - ry, cx + rx, cy + ry)));
  return rot ? xform(p, CK.Matrix.rotated((rot * Math.PI) / 180, cx, cy)) : p;
}
// tapered limb: a smooth hull around two circles
function limb(x0, y0, r0, x1, y1, r1) {
  const dx = x1 - x0, dy = y1 - y0, L = Math.hypot(dx, dy);
  const ux = dx / L, uy = dy / L, nx = -uy, ny = ux;
  const s = (r0 - r1) / L, c = Math.sqrt(Math.max(0, 1 - s * s));
  const t0 = [x0 + r0 * (s * ux + c * nx), y0 + r0 * (s * uy + c * ny)];
  const t1 = [x1 + r1 * (s * ux + c * nx), y1 + r1 * (s * uy + c * ny)];
  const b0 = [x0 + r0 * (s * ux - c * nx), y0 + r0 * (s * uy - c * ny)];
  const b1 = [x1 + r1 * (s * ux - c * nx), y1 + r1 * (s * uy - c * ny)];
  const quad = build((q) => { q.moveTo(...t0); q.lineTo(...t1); q.lineTo(...b1); q.lineTo(...b0); q.close(); });
  return unionAll([quad, ellipse(x0, y0, r0, r0), ellipse(x1, y1, r1, r1)]);
}
function poly(pts, smooth = true) {
  // closed shape through the points; smooth = Catmull-Rom curves
  const n = pts.length;
  return build((p) => {
    p.moveTo(...pts[0]);
    for (let i = 0; i < n; i++) {
      const a = pts[(i - 1 + n) % n], b = pts[i], c = pts[(i + 1) % n], d = pts[(i + 2) % n];
      if (!smooth) { p.lineTo(...c); continue; }
      p.cubicTo(b[0] + (c[0] - a[0]) / 6, b[1] + (c[1] - a[1]) / 6, c[0] - (d[0] - b[0]) / 6, c[1] - (d[1] - b[1]) / 6, c[0], c[1]);
    }
    p.close();
  });
}
const grow = (p, r) => U(p, p.makeStroked({ width: 2 * r, join: CK.StrokeJoin.Round, cap: CK.StrokeCap.Round }));
const moved = (p, dx, dy) => xform(p, CK.Matrix.translated(dx, dy));
const stroke = (p, w) => p.makeStroked({ width: w, join: CK.StrokeJoin.Round, cap: CK.StrokeCap.Round });
const mirror = (p) => xform(p, [-1, 0, 2 * CX, 0, 1, 0, 0, 0, 1]);
const svgPath = (i) => CK.Path.MakeFromSVGString(src[i].d);

// ---------- one shaded part in the source's style ----------
// base (shade colour), a lighter copy nudged toward the light (upper left), optional details
function shaded(shape, { lightShift = [-14, -16], details = [] } = {}) {
  return [
    { path: shape, fill: C.shade },
    { path: I(shape, moved(shape, ...lightShift)), fill: C.light },
    ...details,
  ];
}
// paw: soft oval with two toe lines on the side facing `dir` (down / up / out)
function paw(cx, cy, rx, ry, rot, toeDir = 90) {
  const shape = ellipse(cx, cy, rx, ry, rot);
  const a = (toeDir * Math.PI) / 180;
  const toes = [-0.32, 0.32].map((k) => {
    const ox = cx + Math.cos(a) * ry * 0.55 + Math.cos(a + Math.PI / 2) * rx * k;
    const oy = cy + Math.sin(a) * ry * 0.55 + Math.sin(a + Math.PI / 2) * rx * k;
    const p = build((b) => { b.moveTo(ox - Math.cos(a) * ry * 0.38, oy - Math.sin(a) * ry * 0.38); b.lineTo(ox, oy); });
    return { path: stroke(p, 10), fill: C.ink };
  });
  return { shape, details: toes };
}

// ---------- face: closed mouth with two fangs ----------
function closedMouth() {
  const line = build((b) => { b.moveTo(530, 414); b.cubicTo(620, 426, 745, 426, 832, 412); });
  const fang = (x) => {
    const body = poly([[x - 20, 418], [x + 20, 420], [x + 18, 452], [x, 458], [x - 18, 451]]);
    return [
      { path: grow(body, 7), fill: C.ink },
      { path: body, fill: C.white },
      { path: I(body, moved(body, 12, 0)), fill: C.tooth },
    ];
  };
  return [...fang(588), ...fang(776), { path: stroke(line, 11), fill: C.ink }];
}

// ---------- collar: a symmetric red band under the chin ----------
function collar() {
  const curve = build((b) => { b.moveTo(548, 592); b.cubicTo(600, 640, 766, 640, 818, 592); });
  const band = stroke(curve, 36);
  return [
    { path: grow(band, T * 0.45), fill: C.ink },
    { path: band, fill: C.red },
    { path: I(band, moved(band, 0, 14)), fill: C.redMid },
    { path: I(band, moved(band, 0, 26)), fill: C.redDark },
  ];
}

// ---------- cape flap behind the body ----------
function capeFlap(pts, folds) {
  const shape = poly(pts);
  const out = [{ path: grow(shape, T), fill: C.ink }, { path: shape, fill: C.red }];
  for (const [f, col] of folds) out.push({ path: I(shape, poly(f)), fill: col });
  return out;
}

// ---------- pose definitions (SVG units; head is the source drawing) ----------
const POSES = {
  stand: {
    torso: ellipse(CX, 712, 168, 158),
    belly: ellipse(CX - 4, 745, 118, 104),
    legs: [limb(612, 820, 72, 600, 925, 64)],
    feet: [paw(590, 958, 84, 50, 0, 90)],
    arms: [limb(565, 640, 56, 525, 700, 54)],
    paws: [paw(510, 722, 70, 60, -10, 80)],
    cape: [[[600, 600], [520, 640], [420, 780], [338, 960], [430, 985], [560, 975], [600, 820]],
      [[[[470, 700], [520, 690], [470, 960], [410, 975]], C.redDark], [[[560, 700], [580, 760], [540, 975], [500, 975]], C.redMid]]],
  },
  sit: {
    torso: ellipse(CX, 712, 198, 160),
    belly: ellipse(CX - 4, 740, 140, 106),
    legs: [ellipse(560, 805, 104, 86, -18)],
    feet: [paw(515, 862, 92, 50, -6, 95)],
    arms: [limb(585, 670, 58, 480, 690, 56)],
    paws: [paw(458, 700, 80, 68, -10, 85)],
    cape: [[[600, 600], [500, 650], [400, 730], [290, 822], [420, 868], [560, 870], [600, 760]],
      [[[[420, 740], [480, 720], [430, 865], [350, 850]], C.redDark], [[[520, 720], [560, 760], [520, 870], [470, 868]], C.redMid]]],
  },
};

// head, face (minus the open mouth), collar and medallion straight from the source
const HEAD_FILL = [2, 3, 4, 5, 60, 61];
const FACE_KEEP = [13, 14, 15, 16, 17, 18, 19, 20, 21, 22];      // eyes, nose, cheeks
const MEDALLION = [62, 63, 64, 65, 66, 67, 68, 69];

function drawPose(def) {
  const both = (list) => [...list, ...list.map((x) => (x.path ? { ...x, path: mirror(x.path) } : mirror(x)))];
  const legs = both(def.legs), arms = both(def.arms);
  const feet = [...def.feet, ...def.feet.map((f) => ({ shape: mirror(f.shape), details: f.details.map((d) => ({ ...d, path: mirror(d.path) })) }))];
  const paws = [...def.paws, ...def.paws.map((f) => ({ shape: mirror(f.shape), details: f.details.map((d) => ({ ...d, path: mirror(d.path) })) }))];
  const [capePts, capeFolds] = def.cape;
  const capeL = capeFlap(capePts, capeFolds);
  const capeR = capeL.map((x) => ({ ...x, path: mirror(x.path) }));
  const head = svgPath(2);

  const items = [];
  const add = (list) => items.push(...list);
  // cape behind everything
  add(capeL); add(capeR);
  // one dark silhouette around the whole body, like the source's outline shape
  const lower = unionAll([...legs, ...feet.map((f) => f.shape)]);
  const silhouette = unionAll([head, def.torso, lower, ...arms, ...paws.map((p) => p.shape)]);
  add([{ path: grow(silhouette, T), fill: C.ink }]);
  // legs and feet, then torso (with its own outline over the legs), then arms and paws
  for (const l of legs) add(shaded(l));
  for (const f of feet) add([{ path: grow(f.shape, T * 0.7), fill: C.ink }, ...shaded(f.shape, { details: f.details })]);
  add([{ path: grow(def.torso, T * 0.8), fill: C.ink }, ...shaded(def.torso), { path: I(def.belly, def.torso), fill: C.light }]);
  for (const a of arms) add([{ path: grow(a, T * 0.8), fill: C.ink }, ...shaded(a)]);
  for (const p of paws) add([{ path: grow(p.shape, T * 0.8), fill: C.ink }, ...shaded(p.shape, { details: p.details })]);
  // head: its own outline ring (chin line), source fills, face with a closed mouth
  add([{ path: grow(head, T), fill: C.ink }]);
  add(HEAD_FILL.map((i) => ({ path: svgPath(i), fill: src[i].fill })));
  add(FACE_KEEP.map((i) => ({ path: svgPath(i), fill: src[i].fill })));
  add(closedMouth());
  add(collar());
  // medallion from the source, centred on the face
  add(MEDALLION.map((i) => ({ path: xform(svgPath(i), CK.Matrix.translated(CX - 676, 0)), fill: src[i].fill })));
  return items;
}

for (const [name, def] of Object.entries(POSES)) {
  const items = drawPose(def);
  writeFileSync(`work/pose_${name}.json`, JSON.stringify(items.map((x) => ({ d: x.path.toSVGString(), fill: x.fill }))));
  renderPng(`work/pose_${name}.png`, items, { w: 677, h: 677, scale: 0.5 });
  // onion skin over the video guide: guide pixel = (svg - offset) / 2
  const g = JSON.parse(readFileSync(`work/guide_${name}.json`, "utf8"));
  console.log(name, "parts", items.length);
}
