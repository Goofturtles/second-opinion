"""Re-poses the character from one frame of the clip, using LivePortrait's expression editor.

Runs on ComfyUI's embedded Python (it needs ComfyUI's modules and the AdvancedLivePortrait node):
  C:\\Users\\arjun\\ComfyUI_windows_portable\\python_embeded\\python.exe tools/repose.py SOURCE.png OUT_DIR GRID

GRID is "yaws;pitches", e.g. "-15,0,15;-12,0,12". Every combination is rendered to
OUT_DIR/y{yaw}_p{pitch}.png at the source's full size (the edited face is pasted back onto the
untouched frame). The eyes are turned with the head, a little further, so the gaze leads.
"""

import importlib.util
import os
import sys

import cv2
import numpy as np
import torch
from PIL import Image

COMFY = r'C:\Users\arjun\ComfyUI_windows_portable\ComfyUI'
NODE_DIR = os.path.join(COMFY, 'custom_nodes', 'ComfyUI-AdvancedLivePortrait')

# The pupils travel further than the head, so the eyes lead the turn the way real gaze does.
PUPIL_PER_DEGREE = 0.55

# Paths on the command line are relative to where the script was started, not to ComfyUI.
CALLER_CWD = os.getcwd()
arg_path = lambda p: os.path.join(CALLER_CWD, p)

sys.path.insert(0, COMFY)
os.chdir(COMFY)
spec = importlib.util.spec_from_file_location(
    'advanced_live_portrait', os.path.join(NODE_DIR, '__init__.py'), submodule_search_locations=[NODE_DIR]
)
module = importlib.util.module_from_spec(spec)
sys.modules['advanced_live_portrait'] = module
spec.loader.exec_module(module)
ExpressionEditor = module.NODE_CLASS_MAPPINGS['ExpressionEditor']


# Big enough that the whole quiff sits inside the edited area; at 1.7 the top of the hair stayed
# behind when he looked down.
CROP_FACTOR = 2.1

# LivePortrait redraws the face at 512px, which smooths away the felt fibres. The fine detail of
# the sharp source is carried over onto every pose instead (see restore_detail).
DETAIL_SIGMA = 2.6


def render(editor, src, yaw, pitch, pupil_per_degree=PUPIL_PER_DEGREE):
    result = editor.run(
        rotate_pitch=pitch,
        rotate_yaw=yaw,
        rotate_roll=0,
        blink=0,
        eyebrow=0,
        wink=0,
        pupil_x=max(-15, min(15, yaw * pupil_per_degree)),
        pupil_y=max(-15, min(15, -pitch * pupil_per_degree)),
        aaa=0,
        eee=0,
        woo=0,
        smile=0,
        src_ratio=1,
        sample_ratio=1,
        sample_parts='OnlyExpression',
        crop_factor=CROP_FACTOR,
        src_image=src,
    )
    image = result['result'][0] if isinstance(result, dict) else result[0]
    return image[0].cpu().numpy().astype(np.float32)  # H x W x 3, 0..1


def restore_detail(posed, neutral, detail, mask, flow_engine):
    """Put the source's fine detail back onto a pose, moved the way that pose moved the face.

    `neutral` is LivePortrait's own redraw of the unmoved face: just as soft as `posed`, so optical
    flow between the two is reliable. For each pixel of the pose the flow says where it came from,
    and the source's high-frequency layer is sampled from there. Outside the edited area the pose is
    the untouched source, which already has its detail, so the mask keeps it from doubling.
    """
    to_gray = lambda im: cv2.cvtColor((im * 255).astype(np.uint8), cv2.COLOR_RGB2GRAY)
    flow = flow_engine.calc(to_gray(posed), to_gray(neutral), None)
    h, w = flow.shape[:2]
    gx, gy = np.meshgrid(np.arange(w, dtype=np.float32), np.arange(h, dtype=np.float32))
    moved = cv2.remap(detail, gx + flow[..., 0], gy + flow[..., 1], cv2.INTER_LINEAR, borderMode=cv2.BORDER_REFLECT)
    return np.clip(posed + mask * moved, 0, 1)


def main(source, out_dir, grid):
    yaws, pitches = ([float(v) for v in part.split(',')] for part in grid.split(';'))
    os.makedirs(out_dir, exist_ok=True)

    rgb = np.asarray(Image.open(source).convert('RGB'), dtype=np.float32) / 255.0
    src = torch.from_numpy(rgb)[None]  # ComfyUI IMAGE: [batch, height, width, channels], 0..1
    editor = ExpressionEditor()  # keeps the prepared source between calls while `src` is the same object

    neutral = render(editor, src, 0, 0)
    mask = editor.psi.mask_ori.astype(np.float32)
    if mask.ndim == 2:
        mask = mask[..., None]
    detail = rgb - cv2.GaussianBlur(rgb, (0, 0), DETAIL_SIGMA)
    flow_engine = cv2.DISOpticalFlow_create(cv2.DISOPTICAL_FLOW_PRESET_MEDIUM)

    for pitch in pitches:
        for yaw in yaws:
            posed = neutral if (yaw, pitch) == (0, 0) else render(editor, src, yaw, pitch)
            frame = restore_detail(posed, neutral, detail, mask, flow_engine)
            name = f'y{yaw:+05.1f}_p{pitch:+05.1f}.png'.replace('+', 'p').replace('-', 'm')
            Image.fromarray((frame * 255).round().astype(np.uint8)).save(os.path.join(out_dir, name))
            if os.environ.get('REPOSE_KEEP_RAW'):
                Image.fromarray((posed * 255).round().astype(np.uint8)).save(os.path.join(out_dir, 'raw_' + name))
            print('wrote', name, flush=True)


if __name__ == '__main__':
    main(arg_path(sys.argv[1]), arg_path(sys.argv[2]), sys.argv[3])
