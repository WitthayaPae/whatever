"""The art for the mobile window frame (CMobilePanel, UI-MOBILE-PLAN.md).

Two files from one description:
  CLIENT/textures/gui/mobile_ui.dds      256x256, what the XML names
  CLIENT/textures/gui_hd/mobile_ui.png   1024x1024, the same layout at 4x, which
                                         TextureManager loads in its place on
                                         mobile so the frame stays sharp at 4K

Colours were sampled from the live client's settings window (2026-10-08):
title bar 93->73, idle tab 109/64/68, active tab 182/82/126, panel 11,11,10.

Every swatch is a 16x16 (or 64-tall) cell whose UV rect in the XML is the
middle of the cell (inset 4 px), so a stretched quad never samples its
neighbour: the client insets UVs by only a quarter texel.

    python make-mobile-ui.py            writes both files and prints the XML
"""
import os, struct
from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..', '..'))
DDS = os.path.join(ROOT, 'CLIENT', 'textures', 'gui', 'mobile_ui.dds')
PNG = os.path.join(ROOT, 'CLIENT', 'textures', 'gui_hd', 'mobile_ui.png')
N = 256

def lerp(a, b, t):
    return tuple(int(round(a[i] + (b[i] - a[i]) * t)) for i in range(len(a)))

def grad(stops, n):
    """stops: [(t, rgba)], returns n colours top to bottom."""
    out = []
    for k in range(n):
        t = k / (n - 1)
        for (t0, c0), (t1, c1) in zip(stops, stops[1:]):
            if t0 <= t <= t1:
                out.append(lerp(c0, c1, (t - t0) / (t1 - t0) if t1 > t0 else 0))
                break
    return out

# name -> (x, y, w, h, kind, data)   in 256-space; vertical gradients are 16x64
SW = {}
def solid(name, x, y, rgba): SW[name] = (x, y, 16, 16, 'solid', rgba)
def vgrad(name, x, y, stops): SW[name] = (x, y, 16, 64, 'vgrad', stops)
def hgrad(name, x, y, stops): SW[name] = (x, y, 64, 16, 'hgrad', stops)

solid('MOBILE_UI_BODY',    0, 0, (11, 11, 10, 240))
solid('MOBILE_UI_INNER',  16, 0, (13, 13, 12, 255))
solid('MOBILE_UI_BLACK',  32, 0, (0, 0, 0, 255))
solid('MOBILE_UI_EDGE',   48, 0, (106, 106, 106, 255))
solid('MOBILE_UI_SLOT',   64, 0, (27, 26, 24, 255))
solid('MOBILE_UI_GOLD',   80, 0, (232, 196, 106, 255))
solid('MOBILE_UI_LINE',   96, 0, (44, 43, 41, 255))
solid('MOBILE_UI_SCRIM', 112, 0, (0, 0, 0, 120))
solid('MOBILE_UI_RAIL',  128, 0, (0, 0, 0, 90))
solid('MOBILE_UI_GREEN', 144, 0, (91, 208, 107, 255))
solid('MOBILE_UI_FIELD', 160, 0, (42, 41, 38, 255))
solid('MOBILE_UI_ROWHL', 176, 0, (232, 196, 106, 60))
vgrad('MOBILE_UI_TITLE',  0, 16, [(0, (93, 93, 93, 255)), (1, (63, 63, 63, 255))])
vgrad('MOBILE_UI_TAB',   16, 16, [(0, (109, 109, 109, 255)), (.55, (64, 64, 64, 255)), (1, (68, 68, 68, 255))])
vgrad('MOBILE_UI_TABON', 32, 16, [(0, (182, 182, 182, 255)), (.55, (82, 82, 82, 255)), (1, (126, 126, 126, 255))])
vgrad('MOBILE_UI_WARN',  48, 16, [(0, (201, 106, 95, 255)), (.55, (110, 37, 32, 255)), (1, (141, 58, 51, 255))])
vgrad('MOBILE_UI_CLOSE', 64, 16, [(0, (106, 106, 106, 255)), (1, (58, 58, 58, 255))])
vgrad('MOBILE_UI_GOLDBTN', 80, 16, [(0, (224, 186, 92, 255)), (.55, (122, 90, 18, 255)), (1, (160, 120, 40, 255))])
hgrad('MOBILE_UI_BAR',    0, 80, [(0, (160, 122, 30, 255)), (1, (232, 196, 106, 255))])
hgrad('MOBILE_UI_HP',    64, 80, [(0, (142, 29, 29, 255)), (1, (224, 72, 72, 255))])
SW['MOBILE_UI_X'] = (0, 128, 64, 64, 'x', None)

def paint(scale):
    im = Image.new('RGBA', (N * scale, N * scale), (0, 0, 0, 0))
    px = im.load()
    for name, (x, y, w, h, kind, data) in SW.items():
        X, Y, W, H = x * scale, y * scale, w * scale, h * scale
        if kind == 'solid':
            for j in range(H):
                for i in range(W):
                    px[X + i, Y + j] = data
        elif kind == 'vgrad':
            cols = grad(data, H)
            for j in range(H):
                for i in range(W):
                    px[X + i, Y + j] = cols[j]
        elif kind == 'hgrad':
            cols = grad(data, W)
            for j in range(H):
                for i in range(W):
                    px[X + i, Y + j] = cols[i]
        elif kind == 'x':
            # supersampled X: dark outline, then white stroke
            S = 4
            big = Image.new('RGBA', (W * S, H * S), (0, 0, 0, 0))
            d = ImageDraw.Draw(big)
            m, wd = W * S * 0.24, W * S * 0.13
            for col, extra in (((0, 0, 0, 230), W * S * 0.07), ((236, 236, 234, 255), 0)):
                d.line([(m, m), (W * S - m, H * S - m)], fill=col, width=int(wd + extra))
                d.line([(W * S - m, m), (m, H * S - m)], fill=col, width=int(wd + extra))
            im.alpha_composite(big.resize((W, H), Image.LANCZOS), (X, Y))
    return im

def write_dds(img, path):
    """Uncompressed A8R8G8B8, no mips - the format mobile_icons.dds uses."""
    #  The header of mobile_icons.dds (A8R8G8B8, no mips), with this size.
    w, h = img.size
    ref = open(os.path.join(ROOT, 'CLIENT', 'textures', 'gui', 'mobile_icons.dds'), 'rb').read(128)
    assert ref[:4] == b'DDS ' and struct.unpack('<I', ref[88:92])[0] == 32, 'reference DDS is not 32-bit RGB'
    hdr = bytearray(ref)
    struct.pack_into('<III', hdr, 12, h, w, w * 4)      # dwHeight, dwWidth, dwPitch
    hdr = bytes(hdr)
    body = bytearray()
    for r, g, b, a in img.getdata():
        body += bytes((b, g, r, a))
    with open(path, 'wb') as f:
        f.write(hdr + bytes(body))

if __name__ == '__main__':
    write_dds(paint(1), DDS)
    os.makedirs(os.path.dirname(PNG), exist_ok=True)
    paint(4).save(PNG)
    print('wrote', DDS, '\nwrote', PNG)
    for name, (x, y, w, h, kind, _) in SW.items():
        ix = 0 if kind == 'x' else 4
        iy = 0 if kind == 'x' else (4 if kind in ('solid', 'hgrad') else 2)
        uw = w - 2 * ix
        uh = h - 2 * iy
        print(f'\t<CONTROL Local="Common" Id="{name}">\n\t\t<WINDOW_POS X="0" Y="0" W="{uw}" H="{uh}" />\n'
              f'\t\t<TEXTURE SizeX="256" SizeY="256">mobile_ui.dds</TEXTURE>\n'
              f'\t\t<TEXTURE_POS X="{x + ix}" Y="{y + iy}" W="{uw}" H="{uh}" />\n\t</CONTROL>')
