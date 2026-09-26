"""Bakes the head-follow motion for the landing page.

Runs on ComfyUI's embedded Python (see repose.py):
  C:\\Users\\arjun\\ComfyUI_windows_portable\\python_embeded\\python.exe tools/build_motion.py SOURCE.png public/head

How it works: LivePortrait re-poses the character from one frame of the clip at a grid of head
angles. We don't ship those renders (they're soft at 512px, and blending neighbours ghosts).
Instead, for each angle we measure how every pixel moved (optical flow from the pose back to the
unmoved render) and ship only that motion. The page warps the original, sharp frame by the motion,
blending the four nearest grid angles, so any angle in between is continuous and never doubled.

Writes:
  base.jpg     the untouched frame
  motion.webp  every motion field in one atlas: one cell per grid angle at 1/FACTOR resolution,
               R/G = x/y offset / scale + 128, where each cell has its own scale (in motion.json)
               so small head turns keep sub-pixel precision and the largest still fit in a byte
  motion.json  the numbers the page needs to read it
"""

import json
import os
import sys

import cv2
import numpy as np
import torch
from PIL import Image

sys.path.insert(0, os.path.dirname(__file__))
import repose  # noqa: E402  (sets up ComfyUI and the LivePortrait node)

YAWS = [-18, -13.5, -9, -4.5, 0, 4.5, 9, 13.5, 18]  # + turns towards the viewer's right
PITCHES = [-14, -9.33, -4.67, 0, 4.67, 9.33, 14]  # + tilts down
# The eyes are animated separately in the shader: the 8x-smoothed motion can't carry something
# as small as a pupil, so the head is baked with its eyes still and the page slides his own iris
# across an "empty" eyeball instead. Measured by hand on frame 48 (the only frame used), in source
# pixels: eye white ellipse (centre x, y, radius x, y) and iris ellipse (centre x, y, radius x, y).
EYES = [
    {'white': [1355, 501, 45, 44], 'iris': [1375, 506, 21, 23.5]},
    {'white': [1490, 508, 38.3, 45.5], 'iris': [1504.3, 510.8, 20, 25.8]},
]
EYES_RECT = [1300, 450, 245, 112]  # x, y, width, height of the empty-eyeball texture
FACTOR = 8  # motion is stored at 1/8 of the frame's resolution...
BLUR = 1.5  # ...and smoothed there, which removes tears where hair clumps overlap


def main(source, out_dir):
    os.makedirs(out_dir, exist_ok=True)
    rgb = np.asarray(Image.open(source).convert('RGB'), dtype=np.float32) / 255.0
    frame_h, frame_w = rgb.shape[:2]
    src = torch.from_numpy(rgb)[None]
    editor = repose.ExpressionEditor()
    neutral = repose.render(editor, src, 0, 0, pupil_per_degree=0)
    mask = editor.psi.mask_ori.astype(np.float32)
    mask = mask[..., :1] if mask.ndim == 3 else mask[..., None]

    # Only the area LivePortrait may touch needs motion; snap it to whole motion cells.
    ys, xs = np.nonzero(mask[..., 0] > 1e-3)
    x0, y0 = (xs.min() // FACTOR) * FACTOR, (ys.min() // FACTOR) * FACTOR
    x1 = min(frame_w, -(-(xs.max() + 1) // FACTOR) * FACTOR)
    y1 = min(frame_h, -(-(ys.max() + 1) // FACTOR) * FACTOR)
    cell_w, cell_h = (x1 - x0) // FACTOR, (y1 - y0) // FACTOR

    weights = mask[..., 0]
    gy, gx = np.mgrid[0:frame_h, 0:frame_w]
    face = [float((gx * weights).sum() / weights.sum()), float((gy * weights).sum() / weights.sum())]

    dis = cv2.DISOpticalFlow_create(cv2.DISOPTICAL_FLOW_PRESET_MEDIUM)
    gray = lambda im: cv2.cvtColor((im * 255).astype(np.uint8), cv2.COLOR_RGB2GRAY)
    neutral_gray = gray(neutral)

    atlas = np.full((cell_h * len(PITCHES), cell_w * len(YAWS), 3), 128, np.uint8)
    scales = [1.0] * (len(PITCHES) * len(YAWS))  # source pixels per stored unit, row-major by pitch
    largest = 0.0
    for j, pitch in enumerate(PITCHES):
        for i, yaw in enumerate(YAWS):
            if yaw == 0 and pitch == 0:
                continue  # the unmoved frame: zero motion, already 128
            posed = repose.render(editor, src, yaw, pitch, pupil_per_degree=0)
            flow = dis.calc(gray(posed), neutral_gray, None) * mask  # the background never moves
            small = cv2.resize(flow[y0:y1, x0:x1], (cell_w, cell_h), interpolation=cv2.INTER_AREA)
            small = cv2.GaussianBlur(small, (0, 0), BLUR)
            peak = float(np.abs(small).max())
            largest = max(largest, peak)
            scale = max(peak / 127, 1 / 64)
            scales[j * len(YAWS) + i] = round(scale, 6)
            cell = np.clip(np.round(small / scale) + 128, 0, 255).astype(np.uint8)
            atlas[j * cell_h:(j + 1) * cell_h, i * cell_w:(i + 1) * cell_w, :2] = cell
            print(f'pose yaw {yaw:+.1f} pitch {pitch:+.1f}', flush=True)

    # Lossless WebP: the same bytes as a PNG, about a third smaller.
    Image.fromarray(atlas).save(os.path.join(out_dir, 'motion.webp'), lossless=True, quality=100, method=6)
    # The frame the motion was measured on: it must ship alongside, or nothing lines up.
    Image.fromarray((rgb * 255).round().astype(np.uint8)).save(
        os.path.join(out_dir, 'base.jpg'), quality=92, subsampling=0, optimize=True
    )

    # Empty eyeballs: each iris replaced by the white's own shading. Inpainting borrowed orange skin
    # from just outside the eye (the irises sit near the rim), so instead the white is modelled: a
    # smooth dome, fitted per channel from the visible white alone, then used to fill the hole.
    ex, ey, ew, eh = EYES_RECT
    empty = rgb[ey:ey + eh, ex:ex + ew].copy()
    yy, xx = np.mgrid[ey:ey + eh, ex:ex + ew].astype(np.float32)
    for eye in EYES:
        cx, cy, rx, ry = eye['white']
        ix, iy, irx, iry = eye['iris']
        u, v = (xx - cx) / rx, (yy - cy) / ry
        rim = u * u + v * v  # 0 at the centre of the white, 1 at its edge
        hole_d = ((xx - ix) / (irx + 4)) ** 2 + ((yy - iy) / (iry + 4)) ** 2
        visible = (rim < 0.8) & (hole_d > 1.0)  # clean white: off the rim shadow and off the iris
        features = np.stack([np.ones_like(u), u, v, u * u, u * v, v * v, rim ** 2, rim ** 3], -1)
        coef, *_ = np.linalg.lstsq(features[visible], empty[visible], rcond=None)
        dome = np.clip(features @ coef, 0, 1)
        fill = np.clip((1.5 - hole_d) / 0.5, 0, 1)[..., None] * (rim < 1.0)[..., None]  # solid to 4px past the iris, then feathered
        empty = empty * (1 - fill) + dome * fill
    Image.fromarray((empty * 255).round().astype(np.uint8)).save(os.path.join(out_dir, 'eyes.png'), optimize=True)

    # Closed lids, for blinking: each eye covered by his own skin. The skin is filled in from around
    # the eye, given felt texture from a plain patch of cheek, and shaded with the eyeball's own
    # light so the ball still shows under the lid instead of the eye just vanishing.
    crop = rgb[ey:ey + eh, ex:ex + ew]
    cover = np.zeros((eh, ew), np.uint8)
    for eye in EYES:
        cx, cy, rx, ry = eye['white']
        cv2.ellipse(cover, (round(cx - ex), round(cy - ey)), (round(rx * 1.08 + 3), round(ry * 1.08 + 3)), 0, 0, 360, 255, -1)
    skin = cv2.inpaint((crop * 255).round().astype(np.uint8), cover, 15, cv2.INPAINT_TELEA).astype(np.float32) / 255
    cheek = rgb[575:635, 1240:1300]
    felt = cheek - cv2.GaussianBlur(cheek, (0, 0), 2.5)
    felt = np.hstack([felt, felt[:, ::-1]])
    felt = np.vstack([felt, felt[::-1]])
    felt = np.tile(felt, (eh // felt.shape[0] + 1, ew // felt.shape[1] + 1, 1))[:eh, :ew]
    lum = empty @ np.array([0.299, 0.587, 0.114], np.float32)
    shade = np.ones((eh, ew), np.float32)
    for eye in EYES:
        cx, cy, rx, ry = eye['white']
        d = ((xx - cx) / rx) ** 2 + ((yy - cy) / ry) ** 2
        ratio = lum / lum[d < 1].mean()
        shade = np.where(d < 1.3, shade * (1 + (ratio - 1) * 1.4 * np.clip(1.15 - d, 0, 1)), shade)
    soft = cv2.GaussianBlur(cover.astype(np.float32) / 255, (0, 0), 2)[..., None]
    lids = (skin + felt * soft) * (1 + (shade[..., None] - 1) * soft)
    Image.fromarray((lids.clip(0, 1) * 255).round().astype(np.uint8)).save(os.path.join(out_dir, 'lids.png'), optimize=True)

    manifest = {
        'frame': [frame_w, frame_h],
        'region': [int(x0), int(y0), int(x1), int(y1)],
        'factor': FACTOR,
        'cell': [int(cell_w), int(cell_h)],
        'yaws': YAWS,
        'pitches': PITCHES,
        'scales': scales,
        'face': [round(face[0]), round(face[1])],
        'eyes': EYES,
        'eyesRect': EYES_RECT,
    }
    with open(os.path.join(out_dir, 'motion.json'), 'w') as f:
        json.dump(manifest, f, indent=2)
    print('largest motion', round(largest, 1), 'px;', json.dumps(manifest), flush=True)


if __name__ == '__main__':
    main(repose.arg_path(sys.argv[1]), repose.arg_path(sys.argv[2]))
