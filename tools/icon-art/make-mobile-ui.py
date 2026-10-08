"""The art for the mobile window kit (MobileUiKit.cpp, UI-MOBILE-PLAN.md).

Three window themes the player picks in Settings (RANPARAM::dwMobileUiTheme),
approved 2026-10-08, default C:
    A  Crystal   decorated glass, lit top edge, ornaments, corner brackets
    B  Royal     gold double border, title plaque, filigree corners, ribbons
    C  Tactical  cut corners, edge accents, slanted marker, dashed rules
All at 92% opacity with white buttons.

One atlas, three 256x256 blocks side by side (A | B | C) in the same layout, so
a theme is only a UV offset:
  CLIENT/textures/gui/mobile_ui.dds      768x256
  CLIENT/textures/gui_hd/mobile_ui.png   3072x1024 (4x; the loader uses it on
                                         mobile, so edges stay sharp at 4K)

Inside a block:
  cells 0-9    48x48 nine-slice shapes, 56 apart, 16 px corner segments:
               PANEL INNER BTN PRIMARY / WARN SLOT FIELD ROWHL / RING VEIL
  y=180        16x16 flats: LINE WHITE HP GREEN, then SHEEN (16x32, x=64)
  (0,200)      48x48 close X
  (64,200)     96x24 deco 1   A: ornament line+diamond   B: title plaque   C: -
  (64,228)     96x8  deco 2   A: glow line               B: ribbon band    C: dashed rule
  (168,112)    32x32 corner   A: bracket                 B: filigree       C: slanted marker
The table in MobileUiKit.cpp (block layout) must agree with this file.

    python make-mobile-ui.py
"""
import os, struct
from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..', '..'))
DDS = os.path.join(ROOT, 'CLIENT', 'textures', 'gui', 'mobile_ui.dds')
PNG = os.path.join(ROOT, 'CLIENT', 'textures', 'gui_hd', 'mobile_ui.png')
BLOCK, CELL, PITCH, SEG = 256, 48, 56, 16
SS = 8   # supersample
W = (255, 255, 255)
GOLD = (201, 162, 76)
GOLD_L = (232, 200, 120)

def cell_xy(i):
    return ((i % 4) * PITCH, (i // 4) * PITCH)

class Canvas:
    """Draw in block-local 1x coordinates; renders at scale * SS."""
    def __init__(self, scale):
        self.s = scale
        self.im = Image.new('RGBA', (BLOCK * 3 * scale, BLOCK * scale), (0, 0, 0, 0))

    def paste(self, layer, x, y):
        self.im.alpha_composite(layer.resize((layer.width // SS, layer.height // SS), Image.LANCZOS), (x * self.s, y * self.s))

    def layer(self, w, h):
        L = Image.new('RGBA', (w * self.s * SS, h * self.s * SS), (0, 0, 0, 0))
        return L, ImageDraw.Draw(L), self.s * SS

def shape(d, k, w, h, style, fill, border=None, bw=1.0, inner=None):
    """A cell shape. style: ('round', r) or ('chamfer', c, corners)"""
    def outline(inset):
        i = inset
        if style[0] == 'round':
            return ('round', [i, i, w * k - 1 - i, h * k - 1 - i], max(style[1] * k - i, 1))
        c, corners = style[1] * k, style[2]
        x0, y0, x1, y1 = i, i, w * k - 1 - i, h * k - 1 - i
        cc = max(c - i * 0.41, 1)
        pts = []
        pts += [(x0, y0 + cc), (x0 + cc, y0)] if 'tl' in corners else [(x0, y0)]
        pts += [(x1 - cc, y0), (x1, y0 + cc)] if 'tr' in corners else [(x1, y0)]
        pts += [(x1, y1 - cc), (x1 - cc, y1)] if 'br' in corners else [(x1, y1)]
        pts += [(x0 + cc, y1), (x0, y1 - cc)] if 'bl' in corners else [(x0, y1)]
        return ('poly', pts, None)
    def draw(o, col):
        if o[0] == 'round': d.rounded_rectangle(o[1], o[2], fill=col)
        else: d.polygon(o[1], fill=col)
    if border:
        draw(outline(0), border)
        draw(outline(bw * k), (0, 0, 0, 0))
    if fill:
        draw(outline(bw * k if border else 0), fill)

def paint_cell(cv, bx, idx, style, fill, border=None, bw=1.0, inner=None, sheen=None):
    x, y = cell_xy(idx)
    L, d, k = cv.layer(CELL, CELL)
    shape(d, k, CELL, CELL, style, fill, border, bw)
    if inner:
        # a second hairline inside the border (B's double border)
        col, ins = inner
        M = Image.new('RGBA', L.size, (0, 0, 0, 0))
        md = ImageDraw.Draw(M)
        shape(md, k, CELL, CELL, (style[0], max(style[1] - ins, 2)) + style[2:], None, col, 1.0)
        off = int(ins * k)
        M2 = M.resize((L.width - off * 2, L.height - off * 2))
        L.alpha_composite(M2, (off, off))
    if sheen:
        # lit top edge: a soft white band along the top segment only
        S = Image.new('RGBA', L.size, (0, 0, 0, 0))
        sd = ImageDraw.Draw(S)
        for j in range(int(SEG * k)):
            a = int(sheen * (1 - j / (SEG * k)) ** 2)
            sd.line([(0, j), (L.width, j)], fill=(255, 255, 255, a))
        mask = Image.new('L', L.size, 0)
        shape(ImageDraw.Draw(mask), k, CELL, CELL, style, 255)
        L.alpha_composite(Image.composite(S, Image.new('RGBA', L.size, (0, 0, 0, 0)), mask))
    cv.paste(L, bx + x, y)

def flat(cv, bx, x, y, w, h, rgba):
    L, d, k = cv.layer(w, h)
    d.rectangle([0, 0, L.width, L.height], fill=rgba)
    cv.paste(L, bx + x, y)

def vgrad(cv, bx, x, y, w, h, top, bottom):
    L, d, k = cv.layer(w, h)
    for j in range(L.height):
        t = j / max(L.height - 1, 1)
        d.line([(0, j), (L.width, j)], fill=tuple(int(top[c] + (bottom[c] - top[c]) * t) for c in range(4)))
    cv.paste(L, bx + x, y)

def close_x(cv, bx):
    L, d, k = cv.layer(48, 48)
    m, wd = 48 * k * 0.27, int(48 * k * 0.085)
    d.line([(m, m), (48 * k - m, 48 * k - m)], fill=(240, 240, 240, 255), width=wd)
    d.line([(48 * k - m, m), (m, 48 * k - m)], fill=(240, 240, 240, 255), width=wd)
    cv.paste(L, bx + 0, 200)

def block(cv, theme):
    bx = theme * BLOCK
    if theme == 0:      # A Crystal
        R = ('round', 16)
        paint_cell(cv, bx, 0, R, (22, 26, 34, 235), W + (42,), 1, sheen=40)
        paint_cell(cv, bx, 1, R, W + (14,), W + (24,), 1, sheen=18)
        paint_cell(cv, bx, 2, R, W + (22,), W + (40,), 1, sheen=22)
        paint_cell(cv, bx, 3, R, (238, 238, 238, 255), None, sheen=60)
        paint_cell(cv, bx, 4, R, (214, 72, 66, 235), None)
        paint_cell(cv, bx, 5, R, W + (16,), W + (28,), 1)
        paint_cell(cv, bx, 6, R, (0, 0, 0, 100), W + (40,), 1)
        paint_cell(cv, bx, 7, R, W + (22,), None)
        paint_cell(cv, bx, 8, R, (0, 0, 0, 0), W + (235,), 2.5)
        paint_cell(cv, bx, 9, R, (0, 0, 0, 120), None)
        # ornament: line fading in from the left, a diamond at the right end
        L, d, k = cv.layer(96, 24)
        for xx in range(int(80 * k)):
            a = int(200 * (xx / (80 * k)) ** 1.4)
            d.line([(xx, 12 * k - k), (xx, 12 * k + k)], fill=(255, 255, 255, a))
        c = (88 * k, 12 * k); r = 6 * k
        d.polygon([(c[0] - r, c[1]), (c[0], c[1] - r), (c[0] + r, c[1]), (c[0], c[1] + r)], fill=(255, 255, 255, 255))
        r2 = 3.2 * k
        d.polygon([(c[0] - r2, c[1]), (c[0], c[1] - r2), (c[0] + r2, c[1]), (c[0], c[1] + r2)], fill=(26, 29, 36, 255))
        cv.paste(L, bx + 64, 200)
        # glow line: bright in the middle, fading both ways
        L, d, k = cv.layer(96, 8)
        for xx in range(L.width):
            t = 1 - abs(xx / L.width - 0.5) * 2
            d.line([(xx, 3 * k), (xx, 5 * k)], fill=(255, 255, 255, int(255 * t ** 1.5)))
        cv.paste(L, bx + 64, 228)
        # corner bracket (top-left; the code mirrors it)
        L, d, k = cv.layer(32, 32)
        d.rounded_rectangle([0, 0, 64 * k, 64 * k], 18 * k, outline=(255, 255, 255, 150), width=int(2 * k))
        cv.paste(L, bx + 168, 112)
    elif theme == 1:    # B Royal
        R = ('round', 8)
        paint_cell(cv, bx, 0, R, (20, 18, 26, 235), GOLD + (255,), 2, inner=(GOLD + (110,), 6))
        paint_cell(cv, bx, 1, R, W + (9,), GOLD + (75,), 1)
        paint_cell(cv, bx, 2, R, (40, 36, 30, 235), GOLD + (120,), 1, sheen=18)
        paint_cell(cv, bx, 3, R, (240, 240, 240, 255), GOLD + (255,), 2, sheen=50)
        paint_cell(cv, bx, 4, R, (170, 50, 44, 240), GOLD + (200,), 1)
        paint_cell(cv, bx, 5, R, (0, 0, 0, 90), GOLD + (90,), 1)
        paint_cell(cv, bx, 6, R, (0, 0, 0, 115), GOLD + (130,), 1)
        paint_cell(cv, bx, 7, R, GOLD + (40,), None)
        paint_cell(cv, bx, 8, R, (0, 0, 0, 0), GOLD_L + (255,), 2.5)
        paint_cell(cv, bx, 9, R, (0, 0, 0, 120), None)
        # title plaque: hexagonal ends, gold edge (3-slice: 24 | 48 | 24)
        L, d, k = cv.layer(96, 24)
        w, h = 96 * k, 24 * k
        pts = [(10 * k, 0), (w - 10 * k, 0), (w - 1, h / 2), (w - 10 * k, h - 1), (10 * k, h - 1), (0, h / 2)]
        d.polygon(pts, fill=GOLD + (255,))
        i = 2 * k
        pts2 = [(10 * k + i * .4, i), (w - 10 * k - i * .4, i), (w - 1 - i, h / 2), (w - 10 * k - i * .4, h - 1 - i), (10 * k + i * .4, h - 1 - i), (i, h / 2)]
        d.polygon(pts2, fill=(40, 32, 20, 250))
        cv.paste(L, bx + 64, 200)
        # ribbon band for section headers
        L, d, k = cv.layer(96, 8)
        for xx in range(L.width):
            t = 1 - abs(xx / L.width - 0.5) * 2
            d.line([(xx, 0), (xx, L.height)], fill=GOLD + (int(90 * t),))
        cv.paste(L, bx + 64, 228)
        # filigree corner: an L with a small scroll
        L, d, k = cv.layer(32, 32)
        g = GOLD_L + (255,)
        d.rectangle([0, 0, 30 * k, 2.5 * k], fill=g)
        d.rectangle([0, 0, 2.5 * k, 30 * k], fill=g)
        d.rectangle([6 * k, 6 * k, 16 * k, 7.5 * k], fill=g)
        d.rectangle([6 * k, 6 * k, 7.5 * k, 16 * k], fill=g)
        d.ellipse([18 * k, 1 * k, 24 * k, 7 * k], outline=g, width=int(1.5 * k))
        d.ellipse([1 * k, 18 * k, 7 * k, 24 * k], outline=g, width=int(1.5 * k))
        cv.paste(L, bx + 168, 112)
    else:               # C Tactical
        CH = ('chamfer', 14, ('tl', 'br'))
        BOXC = ('chamfer', 12, ('tr',))
        paint_cell(cv, bx, 0, CH, (24, 28, 34, 235), W + (34,), 1, sheen=30)
        paint_cell(cv, bx, 1, BOXC, W + (12,), None)
        paint_cell(cv, bx, 2, ('chamfer', 10, ('tl', 'br')), W + (24,), W + (40,), 1)
        paint_cell(cv, bx, 3, ('chamfer', 10, ('tl', 'br')), (242, 242, 242, 255), None)
        paint_cell(cv, bx, 4, ('chamfer', 10, ('tl', 'br')), (214, 72, 66, 235), None)
        paint_cell(cv, bx, 5, ('chamfer', 8, ('tl', 'br')), W + (16,), W + (30,), 1)
        paint_cell(cv, bx, 6, ('chamfer', 8, ('tl', 'br')), (0, 0, 0, 115), W + (50,), 1)
        paint_cell(cv, bx, 7, ('chamfer', 6, ('tr',)), W + (22,), None)
        paint_cell(cv, bx, 8, ('chamfer', 8, ('tl', 'br')), (0, 0, 0, 0), W + (235,), 2.5)
        paint_cell(cv, bx, 9, CH, (0, 0, 0, 120), None)
        # dashed rule
        L, d, k = cv.layer(96, 8)
        for n in range(0, 96, 6):
            d.rectangle([n * k, 3.5 * k, (n + 4) * k, 4.5 * k], fill=(238, 232, 170, 170))
        cv.paste(L, bx + 64, 228)
        # slanted marker
        L, d, k = cv.layer(32, 32)
        d.polygon([(12 * k, 0), (22 * k, 0), (14 * k, 32 * k), (4 * k, 32 * k)], fill=(255, 255, 255, 255))
        cv.paste(L, bx + 168, 112)
    flat(cv, bx, 0, 180, 16, 16, W + (22,) if theme != 1 else GOLD + (90,))      # LINE
    flat(cv, bx, 16, 180, 16, 16, (238, 238, 238, 255))                         # WHITE / bar
    flat(cv, bx, 32, 180, 16, 16, (224, 72, 72, 255))                           # HP
    flat(cv, bx, 48, 180, 16, 16, (155, 225, 93, 255))                          # GREEN
    vgrad(cv, bx, 64, 168, 16, 32, (255, 255, 255, 30), (255, 255, 255, 0))     # SHEEN
    close_x(cv, bx)

def paint(scale):
    cv = Canvas(scale)
    for t in range(3):
        block(cv, t)
    return cv.im

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
