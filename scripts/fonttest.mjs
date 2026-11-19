// Render "Twist" in candidate local fonts to compare with the video's logo.
import { CK, paint } from "./lib.mjs";
import { readFileSync, writeFileSync } from "node:fs";
const fonts = ["/System/Library/Fonts/Avenir Next.ttc", "/System/Library/Fonts/Supplemental/Futura.ttc", "/System/Library/Fonts/Supplemental/Arial Rounded Bold.ttf", "/System/Library/Fonts/Avenir.ttc"];
const surface = CK.MakeSurface(720, 140 * fonts.length);
const c = surface.getCanvas();
c.clear(CK.Color(142, 70, 236, 1));
fonts.forEach((f, k) => {
  const tf = CK.Typeface.MakeTypefaceFromData(readFileSync(f).buffer);
  const font = new CK.Font(tf, 96);
  const p = CK.Path.MakeFromText("Twist", 140, 110 + k * 140, font);
  c.drawPath(p, paint([250, 245, 255]));
  console.log(k, f.split("/").pop(), tf ? "ok" : "failed");
});
surface.flush();
writeFileSync("work/fonttest.png", surface.makeImageSnapshot().encodeToBytes());
