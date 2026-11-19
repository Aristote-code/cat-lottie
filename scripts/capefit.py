"""Measure the video's cape flutter as a bend of the SVG's own cape.

Each wing bends around its shoulder: points near the body stay put, the tip swings by
`angle` and stretches by `stretch`, blended smoothly along the wing. For every hover frame
the two parameters per wing are searched to best match the video's cape silhouette.

Usage: python capefit.py <cat-lottie dir> <video-to-lottie dir>
Writes work/capefit.json.
"""
import json
import sys
from pathlib import Path

import cv2
import numpy as np

ROOT, VID = Path(sys.argv[1]), Path(sys.argv[2])
FRAMES = list(range(70, 98))
H, W = 854, 480


def smoothstep(a, b, x):
    t = np.clip((x - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


def bend(pts, anchor, length, angle, stretch):
    """Bend points around `anchor`: weight 0 near the shoulder, 1 at the tip."""
    v = pts - anchor
    d = np.hypot(v[:, 0], v[:, 1]) / length
    w = smoothstep(0.25, 1.0, d)
    a = np.radians(angle) * w
    c, s = np.cos(a), np.sin(a)
    rx = v[:, 0] * c - v[:, 1] * s
    ry = v[:, 0] * s + v[:, 1] * c
    k = 1 + stretch * w
    return anchor + np.stack([rx * k, ry * k], 1)


def main():
    pts = json.loads((ROOT / "work/cape_points.json").read_text())
    al = json.loads((ROOT / "work/align.json").read_text())
    track = {f["frame"]: f for f in json.loads((VID / "work/track.json").read_text())["frames"]}
    K, TX, TY = al["scale"], al["tx"], al["ty"]
    to_vid = lambda p: np.asarray(p, float) * K + [TX, TY]

    body = [to_vid(c) for c in pts["body"]]
    contours = [np.asarray(c, float) for c in pts["cape"]]
    cx = 676.5   # SVG centre line
    # wings: the two biggest contours; the small scrap between the legs stays fixed
    order = sorted(range(len(contours)), key=lambda k: -len(contours[k]))
    wings = {}
    body_svg = np.vstack([np.asarray(c, float) for c in pts["body"]])
    for k in order[:2]:
        c = contours[k]
        side = "left" if c[:, 0].mean() < cx else "right"
        # shoulder anchor: the wing's innermost points (closest to the centre line), near the collar
        inner = c[np.argsort(np.abs(c[:, 0] - cx))[: max(5, len(c) // 12)]]
        anchor = np.array([inner[:, 0].mean(), inner[:, 1].min() + 0.25 * np.ptp(inner[:, 1])])
        tip = c[np.argmax(np.hypot(*(c - anchor).T))]
        wings[side] = {"idx": k, "anchor": anchor, "length": float(np.hypot(*(tip - anchor)))}
    fixed = [contours[k] for k in order[2:]]

    def video_cape(i):
        img = cv2.imread(str(VID / f"work/frames/{i:03d}.png"))
        hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)
        red = (((hsv[..., 0] < 10) | (hsv[..., 0] > 165)) & (hsv[..., 1] > 110) & (hsv[..., 2] > 60)).astype(np.uint8)
        red = cv2.morphologyEx(red, cv2.MORPH_OPEN, np.ones((2, 2), np.uint8))
        return cv2.dilate(red, np.ones((5, 5), np.uint8))   # include the dark rim

    out = {"wings": {s: {"anchor": w["anchor"].tolist(), "length": w["length"]} for s, w in wings.items()}, "frames": []}
    for i in FRAMES:
        t = track[i]
        off = np.array([t["tx"], t["ty"]])
        vc = video_cape(i)
        bm = np.zeros((H, W), np.uint8)
        cv2.fillPoly(bm, [np.round(c + off).astype(np.int32) for c in body], 1)
        visible = bm == 0   # only compare where the body does not cover the cape
        rec = {"frame": i}
        for side, wg in wings.items():
            half = np.zeros((H, W), bool)
            mid = int(round(cx * K + TX + off[0]))
            if side == "left":
                half[:, :mid] = True
            else:
                half[:, mid:] = True
            region = visible & half
            target = vc.astype(bool) & region

            def score(angle, stretch):
                m = np.zeros((H, W), np.uint8)
                c = bend(contours[wg["idx"]], wg["anchor"], wg["length"], angle, stretch)
                cv2.fillPoly(m, [np.round(to_vid(c) + off).astype(np.int32)], 1)
                m = m.astype(bool) & region
                return (m & target).sum() / max(1, (m | target).sum())

            base = score(0, 0)
            best = (base, 0.0, 0.0)
            for a in np.arange(-24, 24.1, 1.5):
                for s in np.arange(-0.18, 0.181, 0.03):
                    v = score(a, s)
                    if v > best[0]:
                        best = (v, a, s)
            # local refinement
            v0, a0, s0 = best
            for a in np.arange(a0 - 1.2, a0 + 1.21, 0.4):
                for s in np.arange(s0 - 0.024, s0 + 0.0241, 0.008):
                    v = score(a, s)
                    if v > best[0]:
                        best = (v, a, s)
            rec[side] = {"angle": round(float(best[1]), 2), "stretch": round(float(best[2]), 3), "iou": round(float(best[0]), 3), "iou_rest": round(float(base), 3)}
        out["frames"].append(rec)
        print(i, " ".join(f"{s}: {rec[s]['angle']:+6.1f}deg s{rec[s]['stretch']:+.2f} IoU {rec[s]['iou_rest']:.2f}->{rec[s]['iou']:.2f}" for s in ("left", "right")))
    (ROOT / "work/capefit.json").write_text(json.dumps(out, indent=1))


main()
