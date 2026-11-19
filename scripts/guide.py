"""Onion-skin guides: the video's stand / sit poses warped into the SVG's coordinate space.

The head is the same drawing in every pose, so it anchors the warp: the SVG head is matched
to the video head (translation only, same scale as the fly pose), then the whole video frame
is mapped into SVG units. Drawings made in SVG units can then be checked against the guide.

Usage: python guide.py <cat-lottie dir> <video-to-lottie dir> <name> <frame>
Writes work/guide_<name>.png (SVG space, half size), work/guide_<name>.json.
"""
import json
import subprocess
import sys
from pathlib import Path

import cv2
import numpy as np

ROOT, VID, NAME, FRAME = Path(sys.argv[1]), Path(sys.argv[2]), sys.argv[3], int(sys.argv[4])
HEAD = "2,3,4,5,60,61,13,16"      # head fill, shades, ear insides, eyes


def main():
    al = json.loads((ROOT / "work/align.json").read_text())
    K = al["scale"]
    img = cv2.imread(str(VID / f"work/frames/{FRAME:03d}.png"))
    bg = cv2.imread(str(VID / "work/debug/background.png"))
    cat = (np.abs(img.astype(int) - bg.astype(int)).max(-1) > 40).astype(np.uint8)
    # video head region: everything above the collar (the gold medallion marks it)
    hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)
    gold = (hsv[..., 0] > 15) & (hsv[..., 0] < 35) & (hsv[..., 1] > 120) & (hsv[..., 2] > 150)
    gy = int(np.nonzero(gold)[0].mean())
    vhead = cat.copy()
    vhead[gy - 8:] = 0
    # SVG head rendered at the fly-pose scale, first guess: centre it on the video head
    ys, xs = np.nonzero(vhead)
    guess_tx = xs.mean() - 676 * K
    guess_ty = ys.min() - 129 * K
    out = ROOT / "work/head_mask.png"
    subprocess.run(["node", "scripts/render_paths.mjs", str(K), str(guess_tx), str(guess_ty), str(out), HEAD], cwd=ROOT, check=True)
    shead = (cv2.imread(str(out), 0) > 127).astype(np.uint8)
    shead = cv2.dilate(shead, np.ones((5, 5), np.uint8))     # include the outline ring
    # slide the SVG head over the video head and keep the best overlap
    hy, hx = np.nonzero(shead)
    y0, y1, x0, x1 = hy.min(), hy.max() + 1, hx.min(), hx.max() + 1
    tmpl = cv2.GaussianBlur(shead[y0:y1, x0:x1].astype(np.float32), (0, 0), 1.5)
    res = cv2.matchTemplate(cv2.GaussianBlur(vhead.astype(np.float32), (0, 0), 1.5), tmpl, cv2.TM_CCORR_NORMED)
    _, score, _, (bx, by) = cv2.minMaxLoc(res)
    tx, ty = guess_tx + (bx - x0), guess_ty + (by - y0)
    print("head match score %.3f" % score)
    # video -> SVG units (half size for viewing): svg = (video - t) / K
    s = 0.5
    M = np.float32([[s / K, 0, -s * tx / K], [0, s / K, -s * ty / K]])
    guide = cv2.warpAffine(img, M, (677, 677), flags=cv2.INTER_CUBIC, borderValue=(255, 255, 255))
    cv2.imwrite(str(ROOT / f"work/guide_{NAME}.png"), guide)
    (ROOT / f"work/guide_{NAME}.json").write_text(json.dumps({"frame": FRAME, "scale": K, "tx": float(tx), "ty": float(ty)}))
    # silhouette extents in SVG units (useful numbers for drawing)
    ys, xs = np.nonzero(cat)
    print(NAME, "frame", FRAME, "t=(%.1f, %.1f)" % (tx, ty), "cat in SVG units: x %.0f..%.0f  y %.0f..%.0f" % (
        (xs.min() - tx) / K, (xs.max() - tx) / K, (ys.min() - ty) / K, (ys.max() - ty) / K))


main()
