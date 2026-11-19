// Export the cape silhouette (cape outline + cape fills) and the body silhouette as dense
// polygons in SVG units, for fitting the cape bend against the video in Python.
// node scripts/cape_points.mjs  ->  work/cape_points.json
import { CK } from "./lib.mjs";
import { readFileSync, writeFileSync } from "node:fs";

const parts = JSON.parse(readFileSync("work/parts.json", "utf8"));
const P = (d) => CK.Path.MakeFromSVGString(d);
function union(list) {
  let acc = null;
  for (const s of list) { const p = P(s.d); acc = acc ? CK.Path.MakeFromOp(acc, p, CK.PathOp.Union) : p; }
  return acc;
}
function polygons(path, step = 4) {
  const out = [];
  const it = new CK.ContourMeasureIter(path, false, 1);
  for (let c = it.next(); c; c = it.next()) {
    const len = c.length(), pts = [];
    for (let s = 0; s < len; s += step) { const pt = c.getPosTan(s); pts.push([+pt[0].toFixed(1), +pt[1].toFixed(1)]); }
    if (pts.length > 2) out.push(pts);
  }
  return out;
}
const cape = union([...parts.shapes.capeOutline, ...parts.shapes.capeBack]);
const body = union(["bodyOutline", "body", "arm", "head", "face", "collar", "medallion"].flatMap((n) => parts.shapes[n]));
writeFileSync("work/cape_points.json", JSON.stringify({ cape: polygons(cape), body: polygons(body) }));
console.log("cape contours", polygons(cape).length, "body contours", polygons(body).length);
