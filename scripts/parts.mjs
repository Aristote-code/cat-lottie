// Split the mascot SVG into named parts for animation.
// The source has one dark outline behind everything; it is cut into a body outline and a
// cape outline (vector boolean ops), so the cape can bend without leaving its edge behind.
// node scripts/parts.mjs  ->  work/parts.json + work/parts_check.png + work/parts_exploded.png
import { readSvgPaths, CK, renderPng } from "./lib.mjs";
import { writeFileSync } from "node:fs";

const SRC = "art/mascot_fly.svg";
const paths = readSvgPaths(SRC);
const range = (a, b) => Array.from({ length: b - a + 1 }, (_, k) => a + k);

// Part map (indices are path order in the source file)
const GROUPS = {
  shadow: [76],
  speedLines: range(77, 80),
  capeBack: [1, ...range(37, 51)],          // both wings + the scrap between the legs
  body: [...range(23, 27), ...range(31, 36)],
  arm: [...range(28, 30), ...range(52, 55)],
  head: [...range(2, 5), 60, 61],
  face: range(6, 22),
  collar: [...range(56, 59), ...range(70, 75)],
  medallion: range(62, 69),
};

const P = (d) => CK.Path.MakeFromSVGString(d);
const op = (a, b, kind) => CK.Path.MakeFromOp(a, b, kind);
function union(ds) {
  let acc = null;
  for (const d of ds) {
    const p = P(d);
    acc = acc ? op(acc, p, CK.PathOp.Union) : p;
  }
  return acc;
}
// grow a filled region by r (stroke its edge and merge)
function grow(path, r) {
  const ring = path.makeStroked({ width: 2 * r, join: CK.StrokeJoin.Round, cap: CK.StrokeCap.Round });
  return op(path, ring, CK.PathOp.Union);
}

const outline = P(paths[0].d);
const capeFill = union(GROUPS.capeBack.map((i) => paths[i].d));
const nonCape = union([...GROUPS.body, ...GROUPS.arm, ...GROUPS.head, ...GROUPS.face, ...GROUPS.collar, ...GROUPS.medallion].map((i) => paths[i].d));

// outline thickness is ~22 units; grow each region by a bit more so every outline pixel is claimed
const R = 30;
const capeZone = grow(capeFill, R);
const bodyZone = grow(nonCape, R);

const bodyOutline = op(outline, bodyZone, CK.PathOp.Intersect);
// cape outline: the outline around the cape; where it overlaps the body outline the body
// layer sits on top, so the seam is hidden
// drop the cape outline's inner edge that runs along the body: it is always under the body
// outline (so the drawing is unchanged), and without it a bent or warped cape has no hidden
// dark edge to drag out from behind the body
const capeOutline = op(op(outline, capeZone, CK.PathOp.Intersect), grow(nonCape, 12), CK.PathOp.Difference);
const leftover = op(op(outline, capeZone, CK.PathOp.Difference), bodyZone, CK.PathOp.Difference);

const area = (p) => { const b = p.computeTightBounds(); return Math.round((b[2] - b[0]) * (b[3] - b[1])); };
console.log("outline split: body bbox area", area(bodyOutline), "cape bbox area", area(capeOutline), "unclaimed bbox area", leftover.isEmpty() ? 0 : area(leftover));

const DARK = paths[0].fill;
const parts = {
  viewBox: [1353, 1353],
  // paint order, back to front
  // as in the source: outlines underneath, every fill on top of them
  order: ["shadow", "speedLines", "capeOutline", "bodyOutline", "capeBack", "body", "arm", "head", "face", "collar", "medallion"],
  shapes: {
    capeOutline: [{ d: capeOutline.toSVGString(), fill: DARK }],
    bodyOutline: [{ d: bodyOutline.toSVGString(), fill: DARK }],
  },
};
for (const [name, idx] of Object.entries(GROUPS)) parts.shapes[name] = idx.map((i) => ({ d: paths[i].d, fill: paths[i].fill, src: i }));
writeFileSync("work/parts.json", JSON.stringify(parts));

// check 1: reassembled drawing (should match the original)
const all = parts.order.flatMap((n) => parts.shapes[n]);
renderPng("work/parts_check.png", all, { w: 677, h: 677, scale: 0.5 });
renderPng("work/original.png", paths, { w: 677, h: 677, scale: 0.5 });
// check 2: cape and its outline only, and body without cape
renderPng("work/parts_cape.png", [...parts.shapes.capeOutline, ...parts.shapes.capeBack], { w: 677, h: 677, scale: 0.5 });
renderPng("work/parts_body.png", ["bodyOutline", "body", "arm", "head", "face", "collar", "medallion"].flatMap((n) => parts.shapes[n]), { w: 677, h: 677, scale: 0.5 });
console.log("parts:", Object.fromEntries(Object.entries(parts.shapes).map(([k, v]) => [k, v.length])));
