// Render a list of SVG paths (by index from the source file, or "all") as a white-on-black mask
// in video frame space.  node scripts/render_paths.mjs <scale> <tx> <ty> <out.png> <indices|all>
import { readSvgPaths, renderPng } from "./lib.mjs";

const [k, tx, ty, out, sel] = process.argv.slice(2);
const paths = readSvgPaths("art/mascot_fly.svg");
const pick = sel === "all" ? paths : sel.split(",").map(Number).map((i) => paths[i]);
renderPng(out, pick.map((p) => ({ d: p.d, fill: [255, 255, 255] })), { w: 480, h: 854, scale: +k, tx: +tx, ty: +ty, bg: [0, 0, 0] });
