"""Set the logo as real vector type, fitted to where it sits in the video.

Glyph outlines come straight from the font (fontTools), so the text is true vector.
Each line is scaled to the measured cap height and letter-spaced to the measured width.

Usage: python text_paths.py <cat-lottie dir> <video-to-lottie dir>
Writes work/text.json.
"""
import json
import sys
from pathlib import Path

import cv2
import numpy as np
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.pens.boundsPen import BoundsPen
from fontTools.ttLib import TTCollection

ROOT, VID = Path(sys.argv[1]), Path(sys.argv[2])
FONT = TTCollection("/System/Library/Fonts/Avenir Next.ttc").fonts[2]   # Avenir Next Demi Bold
GLYPHS = FONT.getGlyphSet()
CMAP = FONT.getBestCmap()
UPM = FONT["head"].unitsPerEm
LINES = {"title": ("Twist", (160, 765, 160, 52)), "tag": ("POWERED BY IST", (160, 816, 160, 28))}


def measure(img, bg, box):
    x, y, w, h = box
    lift = (img[y:y + h, x:x + w].astype(float) - bg[y:y + h, x:x + w].astype(float)).mean(-1)
    ys, xs = np.nonzero(lift > 40)
    colour = img[y:y + h, x:x + w][lift > np.percentile(lift, 97)].mean(0)[::-1]
    return (x + xs.min(), y + ys.min(), x + xs.max() + 1, y + ys.max() + 1), colour


def layout(text, tracking):
    """Glyph names and pen x-offsets in font units (tracking in font units per gap)."""
    out, x = [], 0
    for ch in text:
        g = CMAP[ord(ch)]
        out.append((g, x))
        x += GLYPHS[g].width + tracking
    return out


def ink_bounds(items):
    b = BoundsPen(GLYPHS)
    for g, x in items:
        GLYPHS[g].draw(TransformPen(b, (1, 0, 0, 1, x, 0)))
    return b.bounds   # xMin, yMin, xMax, yMax in font units (y up)


def main():
    img = cv2.imread(str(VID / "work/frames/097.png"))
    bg = cv2.imread(str(VID / "work/debug/background.png"))
    out = {}
    for name, (text, box) in LINES.items():
        (x0, y0, x1, y1), colour = measure(img, bg, box)
        target_w, target_h = x1 - x0, y1 - y0
        # cap height decides the scale; tracking is then solved to hit the measured width
        cap = ink_bounds(layout(text.replace(" ", ""), 0))
        scale = target_h / (cap[3] - max(cap[1], 0) if text.isupper() else cap[3] - cap[1])
        lo, hi = -200.0, 800.0
        for _ in range(40):
            mid = (lo + hi) / 2
            b = ink_bounds(layout(text, mid))
            if (b[2] - b[0]) * scale < target_w:
                lo = mid
            else:
                hi = mid
        items = layout(text, (lo + hi) / 2)
        b = ink_bounds(items)
        # font units (y up) -> frame pixels (y down), ink box aligned to the measured box
        tx = x0 - b[0] * scale
        ty = y1 + b[1] * scale
        pen = SVGPathPen(GLYPHS)
        for g, x in items:
            GLYPHS[g].draw(TransformPen(pen, (scale, 0, 0, -scale, tx + x * scale, ty)))
        out[name] = {"d": pen.getCommands(), "rgb": [round(float(c), 1) for c in colour], "box": [int(x0), int(y0), int(x1), int(y1)]}
        print(name, text, "box", (x0, y0, x1, y1), "scale %.4f" % scale, "colour", out[name]["rgb"])
    (ROOT / "work/text.json").write_text(json.dumps(out))


main()
