"""Find the similarity transform that places the SVG mascot on the video's hover frames.

Renders the SVG silhouette at a first guess, then refines with ECC against the video
cat silhouette (frame 82), and reports the overlap.
Usage: python align.py <cat-lottie dir> <video-to-lottie dir>
Writes work/align.json: svg -> video coordinates as {scale, tx, ty}.
"""
import json
import subprocess
import sys
from pathlib import Path

import cv2
import numpy as np

ROOT, VID = Path(sys.argv[1]), Path(sys.argv[2])
REF = 82


def video_mask(i):
    img = cv2.imread(str(VID / f"work/frames/{i:03d}.png"))
    bg = cv2.imread(str(VID / "work/debug/background.png"))
    d = np.abs(img.astype(int) - bg.astype(int)).max(-1) > 40
    hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)
    d &= ~((hsv[..., 2] > 215) & (hsv[..., 1] < 70))
    n, lab, st, _ = cv2.connectedComponentsWithStats(d.astype(np.uint8), 8)
    m = (lab == 1 + np.argmax(st[1:, cv2.CC_STAT_AREA])).astype(np.uint8)
    cnts, _ = cv2.findContours(m, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
    return cv2.drawContours(np.zeros_like(m), cnts, -1, 1, -1)


def svg_mask(k, tx, ty):
    out = ROOT / "work/svg_mask.png"
    subprocess.run(["node", "scripts/mask.mjs", str(k), str(tx), str(ty), str(out)], cwd=ROOT, check=True)
    return (cv2.imread(str(out), 0) > 127).astype(np.uint8)


def iou(a, b):
    return (a & b).sum() / max(1, (a | b).sum())


def main():
    vm = video_mask(REF)
    ys, xs = np.nonzero(vm)
    # first guess from bounding boxes (SVG outline spans x 229..1125, y 129..1097)
    k = (xs.max() - xs.min()) / (1125 - 229)
    tx, ty = xs.min() - 229 * k, ys.min() - 129 * k
    sm = svg_mask(k, tx, ty)
    print("guess  k=%.4f t=(%.1f,%.1f) IoU=%.3f" % (k, tx, ty, iou(sm, vm)))
    # refine: ECC with a similarity model on blurred silhouettes (template = svg, input = video)
    blur = lambda m: cv2.GaussianBlur(m.astype(np.float32), (0, 0), 3)
    warp = np.eye(2, 3, dtype=np.float32)
    crit = (cv2.TERM_CRITERIA_EPS | cv2.TERM_CRITERIA_COUNT, 500, 1e-7)
    _, warp = cv2.findTransformECC(blur(sm), blur(vm), warp, cv2.MOTION_AFFINE, crit, None, 5)
    a, b, wx, c, d, wy = warp.ravel()
    s = float(np.sqrt(abs(a * d - b * c)))
    rot = float(np.degrees(np.arctan2(c, a)))
    # compose: video = warp(k * svg + t)
    K = k * s
    TX = a * tx + b * ty + wx
    TY = c * tx + d * ty + wy
    sm2 = svg_mask(K, TX, TY)
    print("refined k=%.4f t=(%.1f,%.1f) rot=%.2f deg  IoU=%.3f" % (K, TX, TY, rot, iou(sm2, vm)))
    (ROOT / "work/align.json").write_text(json.dumps({"scale": K, "tx": TX, "ty": TY, "ref_frame": REF, "iou": iou(sm2, vm)}))
    over = np.zeros(vm.shape + (3,), np.uint8)
    over[..., 1] = vm * 255
    over[..., 2] = sm2 * 255
    cv2.imwrite(str(ROOT / "work/align_overlay.png"), over)


main()
