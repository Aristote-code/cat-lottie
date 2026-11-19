"""Cape key drawings for the big shapes (spread wings, overhead canopy).

For a target frame, each wing of the SVG cape is warped onto the video's cape silhouette
with a thin-plate spline: the wing's outer edge (shoulder -> tip -> back to the body) is
matched point-for-point to the video's edge, while the shoulder and the edge hidden behind the
body stay pinned. The warp is stored as TPS parameters in SVG units, so the build can apply it
to every point of the real cape paths (same structure -> smooth morphs between keys).

Usage: python cape_tps.py <cat-lottie dir> <video-to-lottie dir> <frames comma-separated>
Writes work/cape_tps.json and work/cape_tps_<frame>.png previews.
"""
import json
import sys
from pathlib import Path

import cv2
import numpy as np

ROOT, VID = Path(sys.argv[1]), Path(sys.argv[2])
FRAMES = [int(f) for f in sys.argv[3].split(",")]
H, W = 854, 480
M_EDGE = 36           # matched points along each wing's outer edge


def tps_fit(src, dst, reg=1e-3):
    n = len(src)
    d = np.linalg.norm(src[:, None] - src[None], axis=-1)
    Kmat = np.where(d > 0, d * d * np.log(d + 1e-12), 0) + reg * np.eye(n)
    P = np.hstack([np.ones((n, 1)), src])
    L = np.zeros((n + 3, n + 3))
    L[:n, :n], L[:n, n:], L[n:, :n] = Kmat, P, P.T
    rhs = np.zeros((n + 3, 2))
    rhs[:n] = dst
    sol = np.linalg.solve(L, rhs)
    return {"ctrl": src.tolist(), "w": sol[:n].tolist(), "a": sol[n:].tolist()}


def tps_apply(t, pts):
    c, w, a = np.array(t["ctrl"]), np.array(t["w"]), np.array(t["a"])
    d = np.linalg.norm(pts[:, None] - c[None], axis=-1)
    U = np.where(d > 0, d * d * np.log(d + 1e-12), 0)
    return a[0] + pts @ a[1:] + U @ w


def resample(poly, n):
    seg = np.r_[0, np.cumsum(np.hypot(*np.diff(poly, axis=0).T))]
    t = np.linspace(0, seg[-1], n)
    return np.stack([np.interp(t, seg, poly[:, k]) for k in (0, 1)], 1)


def outer_edge(contour, inside_body):
    """The longest run of contour points that are not hidden by the body."""
    vis = ~inside_body
    if vis.all():
        return contour
    start = np.argmax(~vis)                          # roll so the run does not wrap around
    c, v = np.roll(contour, -start, 0), np.roll(vis, -start)
    best, cur = (0, 0), None
    for k, ok in enumerate(np.r_[v, False]):
        if ok and cur is None:
            cur = k
        if not ok and cur is not None:
            if k - cur > best[1] - best[0]:
                best = (cur, k)
            cur = None
    return c[best[0]:best[1]]


def main():
    al = json.loads((ROOT / "work/align.json").read_text())
    K, TX, TY = al["scale"], al["tx"], al["ty"]
    pts = json.loads((ROOT / "work/cape_points.json").read_text())
    fit = json.loads((ROOT / "work/capefit.json").read_text())
    track = {f["frame"]: f for f in json.loads((VID / "work/track_full.json").read_text())}
    CX = 676.5
    contours = [np.asarray(c, float) for c in pts["cape"]]
    order = sorted(range(len(contours)), key=lambda k: -len(contours[k]))[:2]
    body_svg = [np.asarray(c, float) for c in pts["body"]]
    out = {}
    for f in FRAMES:
        A = np.array(track[f]["affine"], float)
        Ainv = np.linalg.inv(np.vstack([A, [0, 0, 1]]))[:2]
        to_vid = lambda p: (np.asarray(p) * K + [TX, TY]) @ A[:, :2].T + A[:, 2]
        to_svg = lambda q: ((np.asarray(q) @ Ainv[:, :2].T + Ainv[:, 2]) - [TX, TY]) / K
        img = cv2.imread(str(VID / f"work/frames/{f:03d}.png"))
        hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)
        red = (((hsv[..., 0] < 10) | (hsv[..., 0] > 165)) & (hsv[..., 1] > 110) & (hsv[..., 2] > 60)).astype(np.uint8)
        red = cv2.dilate(cv2.morphologyEx(red, cv2.MORPH_OPEN, np.ones((2, 2), np.uint8)), np.ones((5, 5), np.uint8))
        body_mask = np.zeros((H, W), np.uint8)
        cv2.fillPoly(body_mask, [np.round(to_vid(c)).astype(np.int32) for c in body_svg], 1)
        mid_x = to_vid(np.array([[CX, 600.0]]))[0, 0]
        src_all, dst_all = [], []
        for k in order:
            wing = contours[k]
            side = "left" if wing[:, 0].mean() < CX else "right"
            # target: the video's cape on this side, joined with the body so the edge runs body -> tip -> body
            # each wing reaches ~10 px past the centre line, so the two overlap where they meet
            # (fills sit above all outlines, so the overlap hides the seam instead of leaving a notch)
            half = np.zeros((H, W), np.uint8)
            if side == "left":
                half[:, : int(mid_x) + 10] = 1
            else:
                half[:, int(mid_x) - 10:] = 1
            tgt = ((red & half) | body_mask).astype(np.uint8)
            n, lab, st, _ = cv2.connectedComponentsWithStats(tgt, 8)
            tgt = (lab == 1 + np.argmax(st[1:, cv2.CC_STAT_AREA])).astype(np.uint8)
            cnts, _ = cv2.findContours(tgt, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
            tc = max(cnts, key=cv2.contourArea)[:, 0, :].astype(float)
            # keep only the cape part of that outline (outside the body and on this side)
            tin = cv2.dilate(body_mask, np.ones((7, 7), np.uint8))[np.clip(tc[:, 1].astype(int), 0, H - 1), np.clip(tc[:, 0].astype(int), 0, W - 1)] > 0
            tedge = outer_edge(tc, tin)
            wv = to_vid(wing)
            win = cv2.dilate(body_mask, np.ones((7, 7), np.uint8))[np.clip(wv[:, 1].astype(int), 0, H - 1), np.clip(wv[:, 0].astype(int), 0, W - 1)] > 0
            wedge = outer_edge(wv, win)
            if len(tedge) < 10 or len(wedge) < 10:
                continue
            # run both edges the same way round (start at the end nearer the collar)
            neck = to_vid(np.array([[CX, 640.0]]))[0]
            if np.hypot(*(wedge[0] - neck)) > np.hypot(*(wedge[-1] - neck)):
                wedge = wedge[::-1]
            if np.hypot(*(tedge[0] - neck)) > np.hypot(*(tedge[-1] - neck)):
                tedge = tedge[::-1]
            src_all.append(to_svg(resample(wedge, M_EDGE)))
            dst_all.append(to_svg(resample(tedge, M_EDGE)))
            # pinned: the wing's points hidden behind the body stay where they are
            # pin only the shoulder: hidden points near the collar stay put; the lower hidden
            # edge is free to follow the hem (pinning it makes the spline overshoot into spikes)
            hidden = to_svg(wv[win])
            edge_svg = to_svg(wedge)
            # pin hidden points near the shoulder, plus a few deep inside the hidden part (well
            # away from the visible edge) so the warp cannot drag the inner edge out from behind the body
            far = np.array([np.min(np.hypot(*(edge_svg - h).T)) for h in hidden]) if len(hidden) else np.array([])
            pins = []
            top = hidden[hidden[:, 1] < 720] if len(hidden) else hidden
            if len(top):
                pins.append(top[np.linspace(0, len(top) - 1, min(6, len(top))).astype(int)])
            deep = hidden[far > 45] if len(hidden) else hidden
            if len(deep):
                pins.append(deep[np.linspace(0, len(deep) - 1, min(8, len(deep))).astype(int)])
            if pins:
                pin = np.vstack(pins)
                src_all.append(pin)
                dst_all.append(pin)
        src = np.vstack(src_all)
        dst = np.vstack(dst_all)
        t = tps_fit(src, dst, reg=400.0)
        out[str(f)] = t
        # preview: warped cape (svg units) over the video target, in video space
        prev = img.copy()
        for c in contours:
            w = tps_apply(t, c)
            cv2.polylines(prev, [np.round(to_vid(w)).astype(np.int32)], True, (0, 255, 255), 1)
        cv2.imwrite(str(ROOT / f"work/cape_tps_{f}.png"), cv2.resize(prev[max(0, int(neck[1]) - 260): int(neck[1]) + 220], None, fx=1.5, fy=1.5))
        m = np.zeros((H, W), np.uint8)
        for c in contours:
            cv2.fillPoly(m, [np.round(to_vid(tps_apply(t, c))).astype(np.int32)], 1)
        vis = body_mask == 0
        a_, b_ = m.astype(bool) & vis, red.astype(bool) & vis
        print(f, "warped cape IoU vs video %.3f" % ((a_ & b_).sum() / max(1, (a_ | b_).sum())))
    (ROOT / "work/cape_tps.json").write_text(json.dumps(out))


main()
