# Daily Hunter icons (2026-10-26), in the style of mk_icons.py (the event icons):
# a framed 35 px cell (70 px in gui_hd). Sheet: textures/gui/dailyhunter01.dds
# (512x256 A8R8G8B8, the header of commercialset07.dds) and
# textures/gui_hd/dailyhunter01.png (1024x512).
# Cells, left to right on row 0:
#   0 coin  1 random box  2 belt card  3 belt attack  4 belt energy  5 belt hit rate  6 belt avoid
#   py mk_icons_hunter.py <CLIENT/textures dir> <out dir>
import sys, math, os
import os as _os, sys as _sys
_sys.path.insert(0, _os.path.dirname(_os.path.abspath(__file__)))
import ranframe
from PIL import Image, ImageDraw, ImageFilter
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

TEX, OUT = sys.argv[1], sys.argv[2]
S = 280

def radial(c_in, c_out, cx=0.5, cy=0.55, r=0.66):
    im = Image.new('RGB', (S, S)); px = im.load()
    for y in range(S):
        for x in range(S):
            t = min(1.0, math.hypot(x - S * cx, y - S * cy) / (S * r)); t = t * t * (3 - 2 * t)
            px[x, y] = tuple(int(c_in[i] + (c_out[i] - c_in[i]) * t) for i in range(3))
    return im.convert('RGBA')

def frame(base):
    # The picture only, without the old drawn border: ranframe.cell() puts the game's own
    # 35 px frame around it (2026-10-26, the user: "the icon it's not align").
    return base.crop((22, 22, S - 22, S - 22))

def outline_paste(base, layer, width=7, color=(25, 10, 5, 255)):
    a = layer.getchannel('A')
    ol = Image.new('RGBA', layer.size, color); ol.putalpha(a.filter(ImageFilter.MaxFilter(width * 2 + 1)))
    base.alpha_composite(ol); base.alpha_composite(layer)

def sparkles(base, pts, col=(255, 250, 220, 230)):
    hl = Image.new('RGBA', (S, S), (0, 0, 0, 0)); hd = ImageDraw.Draw(hl)
    for (sx, sy, r) in pts:
        hd.polygon([(sx, sy - r * 2), (sx + r * .5, sy - r * .5), (sx + r * 2, sy), (sx + r * .5, sy + r * .5),
                    (sx, sy + r * 2), (sx - r * .5, sy + r * .5), (sx - r * 2, sy), (sx - r * .5, sy - r * .5)], fill=col)
    base.alpha_composite(hl)

def sword(d, x0, y0, x1, y1, w=10):
    # a short sword from (x0,y0) hilt to (x1,y1) tip
    L = math.hypot(x1 - x0, y1 - y0); ux, uy = (x1 - x0) / L, (y1 - y0) / L; nx, ny = -uy, ux
    g = 0.22
    hx, hy = x0 + ux * L * g, y0 + uy * L * g
    d.polygon([(hx + nx * w, hy + ny * w), (x1, y1), (hx - nx * w, hy - ny * w)], fill=(235, 240, 250, 255))
    d.line([(hx, hy), (x1, y1)], fill=(170, 180, 200, 255), width=3)
    d.line([(hx + nx * w * 2.2, hy + ny * w * 2.2), (hx - nx * w * 2.2, hy - ny * w * 2.2)], fill=(200, 150, 40, 255), width=9)
    d.line([(x0, y0), (hx, hy)], fill=(110, 60, 25, 255), width=10)

# ------------------------------------------------------------ 0 coin
def coin():
    base = radial((255, 200, 80), (110, 50, 10))
    lay = Image.new('RGBA', (S, S), (0, 0, 0, 0)); d = ImageDraw.Draw(lay)
    cx, cy, R = 140, 148, 92
    d.ellipse([cx - R, cy - R, cx + R, cy + R], fill=(200, 140, 30, 255))
    d.ellipse([cx - R + 10, cy - R + 10, cx + R - 10, cy + R - 10], fill=(250, 205, 70, 255))
    d.ellipse([cx - R + 22, cy - R + 22, cx + R - 22, cy + R - 22], outline=(190, 125, 25, 255), width=5)
    sword(d, cx - 52, cy + 52, cx + 46, cy - 46, 9)
    sword(d, cx + 52, cy + 52, cx - 46, cy - 46, 9)
    lay = lay.filter(ImageFilter.GaussianBlur(0.7)); outline_paste(base, lay)
    hl = Image.new('RGBA', (S, S), (0, 0, 0, 0)); hd = ImageDraw.Draw(hl)
    hd.arc([cx - R + 12, cy - R + 12, cx + R - 12, cy + R - 12], 200, 290, fill=(255, 255, 230, 170), width=6)
    base.alpha_composite(hl)
    sparkles(base, [(212, 66, 9), (62, 214, 7)])
    return frame(base)

# ------------------------------------------------------------ 1 random box
def box():
    base = radial((90, 200, 255), (10, 30, 90))
    lay = Image.new('RGBA', (S, S), (0, 0, 0, 0)); d = ImageDraw.Draw(lay)
    # chest body and lid
    d.rectangle([58, 132, 222, 226], fill=(150, 75, 30, 255))
    d.polygon([(58, 132), (222, 132), (208, 92), (72, 92)], fill=(185, 100, 40, 255))
    for x in (58, 134, 210):
        d.rectangle([x, 92 if x != 134 else 92, x + 12, 226], fill=(225, 175, 60, 255))
    d.rectangle([58, 126, 222, 138], fill=(225, 175, 60, 255))
    d.rectangle([124, 140, 156, 176], fill=(240, 205, 80, 255))
    d.ellipse([134, 150, 146, 162], fill=(60, 30, 10, 255))
    lay = lay.filter(ImageFilter.GaussianBlur(0.7)); outline_paste(base, lay)
    # "?" above the chest
    q = Image.new('RGBA', (S, S), (0, 0, 0, 0)); qd = ImageDraw.Draw(q)
    qd.arc([110, 30, 170, 86], 180, 90, fill=(255, 255, 255, 255), width=13)
    qd.line([(165, 64), (140, 80), (140, 94)], fill=(255, 255, 255, 255), width=13)
    qd.ellipse([133, 100, 147, 114], fill=(255, 255, 255, 255))
    outline_paste(base, q, width=5, color=(10, 20, 60, 255))
    sparkles(base, [(66, 62, 8), (218, 70, 9), (226, 196, 6)])
    return frame(base)

# ------------------------------------------------------------ belt (shared)
def belt_layer(strap, buckle_col):
    lay = Image.new('RGBA', (S, S), (0, 0, 0, 0)); d = ImageDraw.Draw(lay)
    # a curved strap across the cell
    for i in range(0, 200):
        t = i / 199.0
        x = 40 + 200 * t
        y = 150 + 34 * math.sin(math.pi * t) * -1 + 20
        sh = 0.6 + 0.4 * math.cos(math.pi * (t - 0.3))
        col = tuple(int(c * sh) for c in strap) + (255,)
        d.line([(x, y - 26), (x, y + 26)], fill=col, width=3)
    # stitching
    for i in range(0, 200, 10):
        t = i / 199.0; x = 40 + 200 * t; y = 150 - 34 * math.sin(math.pi * t) + 20
        d.line([(x, y - 19), (x + 5, y - 19)], fill=(255, 235, 190, 200), width=2)
        d.line([(x, y + 19), (x + 5, y + 19)], fill=(255, 235, 190, 200), width=2)
    # buckle plate in the middle
    cx, cy = 140, 136
    d.rounded_rectangle([cx - 52, cy - 46, cx + 52, cy + 46], radius=14, fill=(70, 45, 15, 255))
    d.rounded_rectangle([cx - 45, cy - 39, cx + 45, cy + 39], radius=11, fill=buckle_col + (255,))
    d.rounded_rectangle([cx - 33, cy - 27, cx + 33, cy + 27], radius=8, fill=(40, 25, 10, 255))
    return lay, cx, cy

def emblem_attack(d, cx, cy):
    sword(d, cx - 22, cy + 22, cx + 22, cy - 22, 7)
def emblem_energy(d, cx, cy):
    d.ellipse([cx - 20, cy - 20, cx + 20, cy + 20], fill=(80, 170, 255, 255))
    d.ellipse([cx - 12, cy - 14, cx + 4, cy + 2], fill=(210, 240, 255, 255))
def emblem_hit(d, cx, cy):
    d.ellipse([cx - 21, cy - 21, cx + 21, cy + 21], outline=(255, 255, 255, 255), width=5)
    d.ellipse([cx - 9, cy - 9, cx + 9, cy + 9], outline=(255, 255, 255, 255), width=4)
    for a, b in (((cx, cy - 26), (cx, cy - 13)), ((cx, cy + 13), (cx, cy + 26)), ((cx - 26, cy), (cx - 13, cy)), ((cx + 13, cy), (cx + 26, cy))):
        d.line([a, b], fill=(255, 255, 255, 255), width=4)
    d.ellipse([cx - 3, cy - 3, cx + 3, cy + 3], fill=(255, 80, 60, 255))
def emblem_avoid(d, cx, cy):
    # a feathered wing
    for k in range(5):
        y = cy - 16 + k * 8
        d.polygon([(cx - 18, cy + 14), (cx + 22 - k * 3, y - 6), (cx + 10 - k * 3, y + 4)], fill=(240, 230, 255, 255))
    d.ellipse([cx - 22, cy + 8, cx - 12, cy + 18], fill=(255, 255, 255, 255))

def belt(bg_in, bg_out, strap, buckle, emblem):
    base = radial(bg_in, bg_out)
    lay, cx, cy = belt_layer(strap, buckle)
    lay = lay.filter(ImageFilter.GaussianBlur(0.6)); outline_paste(base, lay)
    em = Image.new('RGBA', (S, S), (0, 0, 0, 0)); emblem(ImageDraw.Draw(em), cx, cy)
    outline_paste(base, em, width=3, color=(15, 8, 4, 255))
    sparkles(base, [(216, 64, 8), (60, 70, 6)])
    return frame(base)

# ------------------------------------------------------------ 2 card
def card():
    base = radial((255, 225, 120), (120, 70, 15))
    lay = Image.new('RGBA', (S, S), (0, 0, 0, 0)); d = ImageDraw.Draw(lay)
    d.rounded_rectangle([62, 44, 218, 236], radius=16, fill=(245, 230, 190, 255))
    d.rounded_rectangle([72, 54, 208, 226], radius=12, outline=(190, 140, 40, 255), width=5)
    lay = lay.filter(ImageFilter.GaussianBlur(0.6)); outline_paste(base, lay)
    # a small belt on the card
    small = belt(( 0, 0, 0), (0, 0, 0), (150, 60, 40), (235, 190, 70), emblem_attack)
    bl, cx, cy = belt_layer((150, 60, 40), (235, 190, 70))
    em = Image.new('RGBA', (S, S), (0, 0, 0, 0)); emblem_attack(ImageDraw.Draw(em), cx, cy)
    bl.alpha_composite(em)
    bl = bl.resize((150, 150), Image.LANCZOS)
    base.alpha_composite(bl, (65, 72))
    sparkles(base, [(200, 60, 9), (84, 214, 7)])
    return frame(base)

icons = [
    coin(),
    box(),
    card(),
    belt((255, 110, 80), (90, 10, 10), (150, 40, 30), (240, 190, 70), emblem_attack),     # attack: red
    belt((110, 180, 255), (10, 25, 90), (40, 60, 150), (220, 225, 245), emblem_energy),   # energy: blue
    belt((140, 230, 120), (10, 70, 25), (40, 110, 40), (240, 210, 90), emblem_hit),       # hit rate: green
    belt((200, 140, 255), (40, 10, 80), (90, 50, 140), (225, 225, 240), emblem_avoid),    # avoid: violet
]
os.makedirs(OUT, exist_ok=True)
sheet = Image.new('RGBA', (512, 256), (0, 0, 0, 255))
hd = Image.new('RGB', (1024, 512), (0, 0, 0))
for i, ic in enumerate(icons):
    sheet.paste(ranframe.cell(ic, 1).convert('RGBA'), (i * 35, 0))
    hd.paste(ranframe.cell(ic, 2), (i * 70, 0))
hd.save(os.path.join(OUT, 'dailyhunter01.png'))
ref = open(os.path.join(TEX, 'gui', 'commercialset07.dds'), 'rb').read()
px = sheet.tobytes('raw', 'RGBA')
assert len(ref) == 128 + len(px)
open(os.path.join(OUT, 'dailyhunter01.dds'), 'wb').write(ref[:128] + px)
chk = Image.open(os.path.join(OUT, 'dailyhunter01.dds')).convert('RGBA')
assert chk.size == (512, 256) and chk.getpixel((17, 17)) == sheet.getpixel((17, 17)), 'dds read back'
prev = Image.new('RGB', (len(icons) * 150, 300), (30, 30, 30))
for i, ic in enumerate(icons):
    prev.paste(ic.convert('RGB').resize((140, 140), Image.LANCZOS), (i * 150, 0))
    prev.paste(ranframe.cell(ic, 1).resize((140, 140), Image.NEAREST), (i * 150, 150))
prev.save(os.path.join(OUT, 'icons_preview.png'))
print('ok')
