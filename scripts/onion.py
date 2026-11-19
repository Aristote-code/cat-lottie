"""Overlay a drawn pose (SVG units, rendered half size) on its video guide."""
import sys
import cv2
import numpy as np
name = sys.argv[1]
g = cv2.imread(f"work/guide_{name}.png").astype(np.float32)
p = cv2.imread(f"work/pose_{name}.png").astype(np.float32)
mask = (p.min(-1) < 250)[..., None]
out = np.where(mask, 0.55 * p + 0.45 * g, g)
# outline of the drawing in yellow for a clear edge comparison
edge = cv2.Canny(mask[..., 0].astype(np.uint8) * 255, 50, 150) > 0
out[edge] = (0, 255, 255)
cv2.imwrite(f"work/onion_{name}.png", out.astype(np.uint8))
