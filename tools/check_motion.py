"""Decodes public/head exactly the way the page's shader does, for a few poses, and saves them.

Catches packing mistakes (axis order, sign, scale, cell layout) before they become WebGL bugs.
  python tools/check_motion.py public/head OUT_DIR
"""

import json
import os
import sys

import cv2
import numpy as np
from PIL import Image

head, out_dir = sys.argv[1:3]
os.makedirs(out_dir, exist_ok=True)
m = json.load(open(os.path.join(head, 'motion.json')))
base = np.asarray(Image.open(os.path.join(head, 'base.jpg')).convert('RGB'), dtype=np.float32)
atlas = np.asarray(Image.open(os.path.join(head, 'motion.webp')).convert('RGB'), dtype=np.float32)
fw, fh = m['frame']
x0, y0, x1, y1 = m['region']
cw, ch = m['cell']
cols, rows = len(m['yaws']), len(m['pitches'])


def cell_flow(i, j):
    """Motion of grid cell (yaw index i, pitch index j), upsampled over the region like GL_LINEAR."""
    raw = atlas[j * ch:(j + 1) * ch, i * cw:(i + 1) * cw, :2]
    flow = (raw - 128) * m['scales'][j * cols + i]
    return cv2.resize(flow, (x1 - x0, y1 - y0), interpolation=cv2.INTER_LINEAR)


def render(yaw, pitch):
    gx = (yaw - m['yaws'][0]) / (m['yaws'][-1] - m['yaws'][0]) * (cols - 1)
    gy = (pitch - m['pitches'][0]) / (m['pitches'][-1] - m['pitches'][0]) * (rows - 1)
    i0, j0 = min(int(gx), cols - 2), min(int(gy), rows - 2)
    fx, fy = gx - i0, gy - j0
    flow = (
        cell_flow(i0, j0) * (1 - fx) * (1 - fy)
        + cell_flow(i0 + 1, j0) * fx * (1 - fy)
        + cell_flow(i0, j0 + 1) * (1 - fx) * fy
        + cell_flow(i0 + 1, j0 + 1) * fx * fy
    )
    full = np.zeros((fh, fw, 2), np.float32)
    full[y0:y1, x0:x1] = flow
    xs, ys = np.meshgrid(np.arange(fw, dtype=np.float32), np.arange(fh, dtype=np.float32))
    return cv2.remap(base, xs + full[..., 0], ys + full[..., 1], cv2.INTER_LINEAR, borderMode=cv2.BORDER_REFLECT)


poses = [(18, 14), (15, 11.5), (13, 10), (-15, 11.5), (15, -11.5)]  # the far corners and just inside them
strip = [render(y, p)[0:1000, 1030:1790] for y, p in poses]
Image.fromarray(np.hstack(strip).clip(0, 255).astype(np.uint8)).resize((380 * len(poses), 500)).save(
    os.path.join(out_dir, 'decoded.png')
)
identity = np.abs(render(0, 0) - base).max()
print('rest pose differs from the frame by at most', identity, 'levels')
