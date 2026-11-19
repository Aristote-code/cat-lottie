// Contact sheet: every path of the SVG highlighted in turn (grey drawing, path in its own colour + magenta edge).
// node scripts/inspect.mjs <svg> <out.png> [cols]
import { readSvgPaths, CK, paint, hex } from "./lib.mjs";
import { writeFileSync } from "node:fs";

const [file, out, colsArg] = process.argv.slice(2);
const paths = readSvgPaths(file);
const cols = +(colsArg || 9), cell = 200, S = cell / 1353;
const rows = Math.ceil(paths.length / cols);
const surface = CK.MakeSurface(cols * cell, rows * cell);
const c = surface.getCanvas();
c.clear(CK.WHITE);
const font = new CK.Font(null, 22);
const grey = paint([215, 215, 222]);
paths.forEach((p, k) => {
  const x = (k % cols) * cell, y = Math.floor(k / cols) * cell;
  c.save();
  c.translate(x, y);
  c.scale(S, S);
  for (const q of paths) { const pp = CK.Path.MakeFromSVGString(q.d); c.drawPath(pp, grey); pp.delete(); }
  const pp = CK.Path.MakeFromSVGString(p.d);
  const fill = paint(p.fill), edge = paint([255, 0, 200], 1, 4 / S);
  c.drawPath(pp, fill); c.drawPath(pp, edge);
  fill.delete(); edge.delete(); pp.delete();
  c.restore();
  const tp = paint([0, 0, 0]);
  c.drawText(`${k} ${p.fill}`, x + 4, y + 20, tp, font);
  tp.delete();
});
surface.flush();
const img = surface.makeImageSnapshot();
writeFileSync(out, img.encodeToBytes());
console.log(`${paths.length} paths -> ${out}`);
