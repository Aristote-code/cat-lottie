// Shared helpers: Skia (CanvasKit) for path parsing, boolean ops and rendering.
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire("/Users/ariga/Documents/subject-lottie/package.json");
const CanvasKitInit = require("canvaskit-wasm/full");
export const CK = await CanvasKitInit({ locateFile: (f) => require.resolve("canvaskit-wasm/full").replace(/canvaskit\.js$/, f) });

export function readSvgPaths(file) {
  const text = readFileSync(file, "utf8");
  return [...text.matchAll(/<path d="([^"]+)" fill="(#[0-9A-Fa-f]{6})"/g)].map((m, i) => ({ i, d: m[1], fill: m[2].toUpperCase() }));
}

export const hex = (h) => [1, 3, 5].map((k) => parseInt(h.slice(k, k + 2), 16));
export function paint(color, alpha = 1, stroke = 0) {
  const p = new CK.Paint();
  const [r, g, b] = typeof color === "string" ? hex(color) : color;
  p.setColor(CK.Color(r, g, b, alpha));
  p.setAntiAlias(true);
  if (stroke) { p.setStyle(CK.PaintStyle.Stroke); p.setStrokeWidth(stroke); p.setStrokeJoin(CK.StrokeJoin.Round); p.setStrokeCap(CK.StrokeCap.Round); }
  return p;
}

// items: [{ d | path, fill, alpha?, stroke? }]; view: { w, h, scale, tx, ty, bg }
export function renderPng(file, items, { w, h, scale = 1, tx = 0, ty = 0, bg = [255, 255, 255] }) {
  const surface = CK.MakeSurface(w, h);
  const c = surface.getCanvas();
  c.clear(CK.Color(...bg, 1));
  c.save();
  c.translate(tx, ty);
  c.scale(scale, scale);
  for (const it of items) {
    const path = it.path || CK.Path.MakeFromSVGString(it.d);
    const p = paint(it.fill, it.alpha ?? 1, it.stroke ? it.stroke / scale : 0);
    c.drawPath(path, p);
    p.delete();
    if (!it.path) path.delete();
  }
  c.restore();
  surface.flush();
  const img = surface.makeImageSnapshot();
  writeFileSync(file, img.encodeToBytes());
  img.delete(); surface.delete();
}

export function bounds(d) {
  const p = CK.Path.MakeFromSVGString(d);
  const b = p.computeTightBounds();
  p.delete();
  return { x: b[0], y: b[1], w: b[2] - b[0], h: b[3] - b[1] };
}
