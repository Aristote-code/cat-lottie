// Render the mascot's full silhouette (white on black) into the video frame size.
// node scripts/mask.mjs <scale> <tx> <ty> <out.png>
import { readSvgPaths, renderPng } from "./lib.mjs";

const [k, tx, ty, out] = process.argv.slice(2);
const outline = readSvgPaths("art/mascot_fly.svg")[0];
renderPng(out, [{ d: outline.d, fill: [255, 255, 255] }], { w: 480, h: 854, scale: +k, tx: +tx, ty: +ty, bg: [0, 0, 0] });
