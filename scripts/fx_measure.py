"""Measure the light effects in the video so they can be redrawn as clean vectors.

For every frame: the light shapes that are not the cat (clouds, puffs, speed lines,
sparkles). Each is classified by size and shape, and clouds/puffs are linked across frames
into tracks so each can be drawn once and animated.

Usage: python fx_measure.py <cat-lottie dir> <video-to-lottie dir>
Writes work/fx_tracks.json.
"""
import json
import sys
from pathlib import Path

import cv2
import numpy as np

ROOT, VID = Path(sys.argv[1]), Path(sys.argv[2])
N, H, W = 97, 854, 480
LOGO = (150, 760, 180, 90)


def main():
    bg = cv2.imread(str(VID / "work/debug/background.png")).astype(np.float32)
    frames = []
    for i in range(1, N + 1):
        img = cv2.imread(str(VID / f"work/frames/{i:03d}.png"))
        f = img.astype(np.float32)
        hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)
        diff = np.abs(f - bg).max(-1) > 22
        lighter = (f.mean(-1) - bg.mean(-1)) > 18
        # the cat: strong, non-light foreground (body, cape, outline), grown to swallow its edges
        cat = diff & ~((hsv[..., 2] > 200) & (hsv[..., 1] < 90))
        n, lab, st, _ = cv2.connectedComponentsWithStats(cat.astype(np.uint8), 8)
        catm = np.zeros((H, W), np.uint8)
        if n > 1:
            catm = (lab == 1 + np.argmax(st[1:, cv2.CC_STAT_AREA])).astype(np.uint8)
            catm = cv2.dilate(catm, np.ones((9, 9), np.uint8))
        light = diff & lighter & ~catm.astype(bool)
        x, y, w, h = LOGO
        light[y:y + h, x:x + w] = False
        light[:24, :24] = light[:24, -24:] = light[-24:, :24] = light[-24:, -24:] = False   # video corners
        n, lab, st, cen = cv2.connectedComponentsWithStats(light.astype(np.uint8), 8)
        items = []
        for k in range(1, n):
            bx, by, bw, bh, area = st[k]
            if area < 4:
                continue
            region = img[lab == k].astype(float)
            whiteness = float(region.min(-1).mean())
            if bh >= 3 * bw and bw <= 9 and area >= 12:
                kind = "line"
            elif area < 160 and whiteness > 215 and bw >= 3:
                kind = "sparkle"
            elif area < 160:
                kind = "puff"
            else:
                kind = "cloud"
            items.append({"kind": kind, "cx": float(cen[k][0]), "cy": float(cen[k][1]), "x": int(bx), "y": int(by), "w": int(bw), "h": int(bh), "area": int(area)})
        frames.append({"frame": i, "items": items})

    # link clouds and puffs over time (nearest centre, similar size)
    tracks = []
    for fr in frames:
        for it in fr["items"]:
            if it["kind"] not in ("cloud", "puff"):
                continue
            best, bd = None, 1e9
            for t in tracks:
                last = t["keys"][-1]
                if last["frame"] != fr["frame"] - 1 or t.get("_taken") == fr["frame"]:
                    continue
                d = np.hypot(last["cx"] - it["cx"], last["cy"] - it["cy"]) + 0.15 * abs(np.sqrt(last["area"]) - np.sqrt(it["area"]))
                if d < bd and d < 22 + 0.25 * np.sqrt(last["area"]):
                    best, bd = t, d
            key = {"frame": fr["frame"], **{k: it[k] for k in ("cx", "cy", "x", "y", "w", "h", "area")}}
            if best is None:
                tracks.append({"kind": it["kind"], "keys": [key], "_taken": fr["frame"]})
            else:
                best["keys"].append(key)
                best["_taken"] = fr["frame"]
                if it["kind"] == "cloud":
                    best["kind"] = "cloud"
    tracks = [{k: v for k, v in t.items() if k != "_taken"} for t in tracks if len(t["keys"]) >= 2]
    out = {"frames": frames, "tracks": tracks}
    (ROOT / "work/fx_tracks.json").write_text(json.dumps(out))
    kinds = {}
    for fr in frames:
        for it in fr["items"]:
            kinds.setdefault(it["kind"], set()).add(fr["frame"])
    for k, fs in kinds.items():
        print(k, "frames", min(fs), "-", max(fs), "(", len(fs), "frames )")
    print("tracks:", len(tracks), [(t["kind"], t["keys"][0]["frame"], t["keys"][-1]["frame"], max(kk["area"] for kk in t["keys"])) for t in tracks if max(kk["area"] for kk in t["keys"]) > 60])


main()
