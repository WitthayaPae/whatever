"""Higher-resolution item and skill icons for the phone (2026-10-05).

The icons are 35x35 texels (SkillFunc.h ICON_PIXEL_X) in 512x256 atlases. A
phone now draws a window 2x (window magnify), which puts ~3.7 screen pixels on
every texel and the art shows as blocks. Filtering cannot add detail that is
not there; measured side by side (scratchpad research/icon_compare.png),
Real-ESRGAN x4plus kept the classic look and was the only method that was
sharp without being blurry.

Each atlas is upscaled 4x by Real-ESRGAN x4plus and reduced to 2x with Lanczos
(4x is supersampling: sharper than a straight 2x), alpha (if any) upscaled 2x
bicubic. Written as lossless PNG to CLIENT/textures/gui_hd/<name lowercased>.png.
The phone loads those in place of textures/gui/<name>.dds (shim
d3dx_loaders.cpp); the icon UVs come from fixed constants, so a 2x atlas drops
in. The PC client never reads gui_hd.

    python make-icon-hd.py <RealESRGAN_x4plus.pth> [--only name.dds ...]

Already-written files are skipped, so it can be stopped and resumed.
"""
import csv, json, os, sys, time
import numpy as np
import torch
from PIL import Image
from spandrel import ModelLoader

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..', '..'))
SRC = os.path.join(ROOT, 'CLIENT', 'textures', 'gui')
DST = os.path.join(ROOT, 'CLIENT', 'textures', 'gui_hd')


def icon_atlases():
    """Every atlas an item or a skill takes its icon from."""
    names = set()
    import subprocess
    #  Items: the item database the rcc-extract tools build.
    db = os.environ.get('ITEMDB_JSON')
    if db and os.path.exists(db):
        d = json.load(open(db, encoding='utf-8'))
        items = d['items'] if isinstance(d, dict) and 'items' in d else d
        names |= {x['f'].lower() for x in items if x.get('f')}
    #  Skills: strICONFILE in skill.csv.
    sk = os.path.join(ROOT, 'CLIENT', 'data', 'glogic', 'skill.csv')
    r = csv.reader(open(sk, encoding='cp874', errors='replace', newline=''))
    h = next(r)
    col = h.index('strICONFILE')
    for row in r:
        if col < len(row) and row[col].lower().endswith('.dds'):
            names.add(row[col].lower())
    return sorted(names)


def main():
    weights = sys.argv[1]
    only = [a.lower() for a in sys.argv[3:]] if len(sys.argv) > 2 and sys.argv[2] == '--only' else None
    os.makedirs(DST, exist_ok=True)
    on_disk = {f.lower(): f for f in os.listdir(SRC)}
    names = only or icon_atlases()
    model = ModelLoader().load_from_file(weights).model.eval()
    torch.set_num_threads(max(1, os.cpu_count() or 1))
    done = missing = 0
    for n, name in enumerate(names):
        out = os.path.join(DST, os.path.splitext(name)[0] + '.png')
        if os.path.exists(out):
            continue
        real = on_disk.get(name)
        if not real:
            missing += 1
            print('missing', name, flush=True)
            continue
        t0 = time.time()
        img = Image.open(os.path.join(SRC, real))
        img.load()
        has_alpha = img.mode in ('RGBA', 'LA') or ('transparency' in img.info)
        rgba = img.convert('RGBA')
        w, h = rgba.size
        rgb = np.asarray(rgba.convert('RGB')).astype(np.float32) / 255.0
        x = torch.from_numpy(rgb).permute(2, 0, 1)[None]
        with torch.no_grad():
            y = model(x)
        y = (y[0].permute(1, 2, 0).clamp(0, 1).numpy() * 255.0 + 0.5).astype(np.uint8)
        big = Image.fromarray(y).resize((w * 2, h * 2), Image.LANCZOS)
        if has_alpha:
            a = rgba.getchannel('A')
            if a.getextrema() != (255, 255):
                big = big.convert('RGBA')
                big.putalpha(a.resize((w * 2, h * 2), Image.BICUBIC))
        big.save(out, optimize=True)
        done += 1
        print('%d/%d %s %dx%d -> %dx%d %s %.1fs %dKB' % (n + 1, len(names), real, w, h, w * 2, h * 2,
              big.mode, time.time() - t0, os.path.getsize(out) // 1024), flush=True)
    print('done %d, missing %d' % (done, missing))


if __name__ == '__main__':
    main()
