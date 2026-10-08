"""The art for the mobile window kit (MobileUiKit.cpp, UI-MOBILE-PLAN.md).

Style v4, approved 2026-10-08: modern glass windows, 92% opaque, white accent.

Two files from one description:
  CLIENT/textures/gui/mobile_ui.dds      256x256, what the XML names
  CLIENT/textures/gui_hd/mobile_ui.png   1024x1024, the same layout at 4x, which
                                         TextureManager loads in its place on
                                         mobile so corners stay sharp at 4K

Nine-slice cells: each style is a 48x48 cell holding a rounded rectangle whose
corners are 16 px; CMobileBox cuts it into 3x3 pieces (16-16-16) and draws the
corners at the radius each kind asks for. Cells sit 56 px apart so a stretched
piece never samples its neighbour. Flat swatches (lines, bars) are 16x16 with
the UV taken from their middle.

The cell table here and in MobileUiKit.cpp (SCELL) must agree.

    python make-mobile-ui.py
"""
import os, struct
from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..', '..'))
DDS = os.path.join(ROOT, 'CLIENT', 'textures', 'gui', 'mobile_ui.dds')
PNG = os.path.join(ROOT, 'CLIENT', 'textures', 'gui_hd', 'mobile_ui.png')
N = 256
CELL, PITCH, R = 48, 56, 16

W = (255, 255, 255)
# index: (fill rgba, border rgba or None, border width px at 1x)
CELLS = [
    ((16, 19, 25, 235), W + (36,), 1),     # 0 PANEL  glass window
    (W + (11,),         W + (20,), 1),     # 1 INNER  box inside a window
    (W + (23,),         W + (36,), 1),     # 2 BTN    secondary button, tab
    ((236, 236, 236, 255), None, 0),       # 3 PRIMARY white button / active tab
    ((214, 72, 66, 232), None, 0),         # 4 WARN
    (W + (15,),         W + (26,), 1),     # 5 SLOT
    ((0, 0, 0, 90),     W + (36,), 1),     # 6 FIELD  number box
    (W + (20,),         None, 0),          # 7 ROWHL  selected row
    ((0, 0, 0, 0),      W + (235,), 2.5),  # 8 RING   selection ring
    ((0, 0, 0, 120),    None, 0),          # 9 VEIL   dim behind a dialog
]
FLATS = {                                   # name: (x, y, rgba)
    'LINE':  (0, 180, W + (18,)),
    'WHITE': (16, 180, (236, 236, 236, 255)),
    'HP':    (32, 180, (224, 72, 72, 255)),
    'GREEN': (48, 180, (155, 225, 93, 255)),
}
X_AT = (0, 200, 48)                         # close icon: x, y, size

def cell_xy(i):
    return ((i % 4) * PITCH, (i // 4) * PITCH)

def paint(scale):
    im = Image.new('RGBA', (N * scale, N * scale), (0, 0, 0, 0))
    S = 8  # supersample for smooth corners
    for i, (fill, border, bw) in enumerate(CELLS):
        x, y = cell_xy(i)
        big = Image.new('RGBA', (CELL * scale * S,) * 2, (0, 0, 0, 0))
        d = ImageDraw.Draw(big)
        e = CELL * scale * S - 1
        r = R * scale * S
        if border:
            d.rounded_rectangle([0, 0, e, e], r, fill=border)
            b = int(round(bw * scale * S))
            d.rounded_rectangle([b, b, e - b, e - b], max(r - b, 1), fill=(0, 0, 0, 0))
            inner = Image.new('RGBA', big.size, (0, 0, 0, 0))
            ImageDraw.Draw(inner).rounded_rectangle([b, b, e - b, e - b], max(r - b, 1), fill=fill)
            big = Image.alpha_composite(big, inner)
        else:
            d.rounded_rectangle([0, 0, e, e], r, fill=fill)
        im.alpha_composite(big.resize((CELL * scale,) * 2, Image.LANCZOS), (x * scale, y * scale))
    px = im.load()
    for name, (x, y, rgba) in FLATS.items():
        for j in range(16 * scale):
            for k in range(16 * scale):
                px[x * scale + k, y * scale + j] = rgba
    xs, ys, sz = X_AT
    big = Image.new('RGBA', (sz * scale * S,) * 2, (0, 0, 0, 0))
    d = ImageDraw.Draw(big)
    m, wd = sz * scale * S * 0.27, int(sz * scale * S * 0.085)
    d.line([(m, m), (sz * scale * S - m, sz * scale * S - m)], fill=(240, 240, 240, 255), width=wd)
    d.line([(sz * scale * S - m, m), (m, sz * scale * S - m)], fill=(240, 240, 240, 255), width=wd)
    im.alpha_composite(big.resize((sz * scale,) * 2, Image.LANCZOS), (xs * scale, ys * scale))
    return im

def write_dds(img, path):
    """Uncompressed A8R8G8B8, no mips - the header of mobile_icons.dds with this size."""
    w, h = img.size
    ref = open(os.path.join(ROOT, 'CLIENT', 'textures', 'gui', 'mobile_icons.dds'), 'rb').read(128)
    assert ref[:4] == b'DDS ' and struct.unpack('<I', ref[88:92])[0] == 32, 'reference DDS is not 32-bit RGB'
    hdr = bytearray(ref)
    struct.pack_into('<III', hdr, 12, h, w, w * 4)
    body = bytearray()
    for r, g, b, a in img.getdata():
        body += bytes((b, g, r, a))
    with open(path, 'wb') as f:
        f.write(bytes(hdr) + bytes(body))

if __name__ == '__main__':
    write_dds(paint(1), DDS)
    os.makedirs(os.path.dirname(PNG), exist_ok=True)
    paint(4).save(PNG)
    print('wrote', DDS, '\nwrote', PNG)
