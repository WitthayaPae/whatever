# Two event-item icons in the style of the game's commercialset sheets, and the
# sheet files: textures/gui/eventexchange01.dds (512x256, A8R8G8B8, 1 level, the
# same header as commercialset07.dds) and textures/gui_hd/eventexchange01.png
# (1024x512 RGB). Cells: 35 px (70 px in gui_hd); 512/57 at (0,0), 512/58 at (1,0).
#   py mk_icons.py <CLIENT/textures dir> <out dir>
import sys, math, os
import os as _os, sys as _sys
_sys.path.insert(0, _os.path.dirname(_os.path.abspath(__file__)))
import ranframe
from PIL import Image, ImageDraw, ImageFilter, ImageChops

TEX, OUT = sys.argv[1], sys.argv[2]
S = 280                       # drawing size (8x the 35 px cell)

def radial(size, c_in, c_out, cx, cy, r):
    im = Image.new('RGB', (size, size))
    px = im.load()
    for y in range(size):
        for x in range(size):
            t = min(1.0, math.hypot(x - cx, y - cy) / r)
            t = t * t * (3 - 2 * t)
            px[x, y] = tuple(int(c_in[i] + (c_out[i] - c_in[i]) * t) for i in range(3))
    return im

def frame(base):
    # The picture only, without the old drawn border: ranframe.cell() puts the game's own
    # 35 px frame around it (2026-10-26, the user: "the icon it's not align").
    return base.crop((22, 22, S - 22, S - 22))

def outline_paste(base, layer, width=7, color=(25, 10, 5, 255)):
    a = layer.getchannel('A')
    grown = a.filter(ImageFilter.MaxFilter(width * 2 + 1))
    ol = Image.new('RGBA', layer.size, color)
    ol.putalpha(grown)
    base.alpha_composite(ol)
    base.alpha_composite(layer)

def feather():
    base = radial(S, (255, 150, 40), (90, 15, 10), S * 0.5, S * 0.62, S * 0.62).convert('RGBA')
    lay = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(lay)
    # quill: a curve from bottom-left to top-right
    def q(t):   # point along the quill, t 0..1
        x0, y0, x1, y1 = 72, 222, 214, 58
        cx, cy = 92, 92
        x = (1 - t) ** 2 * x0 + 2 * (1 - t) * t * cx + t * t * x1
        y = (1 - t) ** 2 * y0 + 2 * (1 - t) * t * cy + t * t * y1
        return x, y
    def normal(t):
        a, b = q(max(0, t - 0.01)), q(min(1, t + 0.01))
        dx, dy = b[0] - a[0], b[1] - a[1]; L = math.hypot(dx, dy)
        return -dy / L, dx / L
    # vanes: barbs both sides, gold at the base to flame red at the tip
    for i in range(0, 120):
        t = 0.14 + 0.84 * i / 119
        w = 62 * math.sin(math.pi * min(1, (t - 0.1) / 0.92)) ** 0.8
        x, y = q(t); nx, ny = normal(t)
        col_t = (t - 0.14) / 0.84
        col = (255, int(215 - 140 * col_t), int(90 - 70 * col_t), 255)
        for side in (1, -1):
            ww = w * (1.0 if side == 1 else 0.82)
            ex, ey = x + side * nx * ww + 10 * (q(min(1, t + 0.08))[0] - x) / 10, y + side * ny * ww - 14
            d.line([(x, y), (ex, ey)], fill=col, width=5)
    # flame wisps at the tip
    for k, (ox, oy, r) in enumerate([(206, 52, 26), (190, 40, 18), (222, 72, 16)]):
        d.ellipse([ox - r, oy - r, ox + r, oy + r], fill=(255, 90 + 30 * k, 30, 230))
    # quill
    pts = [q(i / 60) for i in range(61)]
    d.line(pts, fill=(255, 245, 210, 255), width=7)
    lay = lay.filter(ImageFilter.GaussianBlur(0.8))
    outline_paste(base, lay)
    # highlight along the quill and sparkles
    hl = Image.new('RGBA', (S, S), (0, 0, 0, 0)); hd = ImageDraw.Draw(hl)
    hd.line([q(i / 60) for i in range(8, 50)], fill=(255, 255, 255, 170), width=3)
    for (sx, sy, r) in [(110, 70, 9), (226, 118, 7), (60, 150, 6)]:
        hd.polygon([(sx, sy - r * 2), (sx + r * 0.5, sy - r * 0.5), (sx + r * 2, sy), (sx + r * 0.5, sy + r * 0.5),
                    (sx, sy + r * 2), (sx - r * 0.5, sy + r * 0.5), (sx - r * 2, sy), (sx - r * 0.5, sy - r * 0.5)], fill=(255, 250, 220, 230))
    base.alpha_composite(hl)
    return frame(base)

def ring_shard():
    base = radial(S, (175, 90, 230), (30, 10, 60), S * 0.5, S * 0.58, S * 0.62).convert('RGBA')
    lay = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(lay)
    cx, cy, R, w = 140, 156, 82, 30
    # a broken arc of a ring band (about 230 degrees), silver with shading
    for i in range(0, 231):
        a = math.radians(160 + i)
        sh = 0.55 + 0.45 * math.cos(a - math.radians(250))
        col = (int(200 * sh + 40), int(205 * sh + 40), int(225 * sh + 30), 255)
        x0, y0 = cx + (R - w / 2) * math.cos(a), cy + (R - w / 2) * math.sin(a)
        x1, y1 = cx + (R + w / 2) * math.cos(a), cy + (R + w / 2) * math.sin(a)
        d.line([(x0, y0), (x1, y1)], fill=col, width=4)
    # jagged broken ends
    for ang, sgn in ((160, -1), (390, 1)):
        a = math.radians(ang)
        pts = []
        for k in range(5):
            r = R - w / 2 + w * k / 4
            jag = (6 if k % 2 else -6) * sgn
            pts.append((cx + r * math.cos(a + math.radians(jag / 3)), cy + r * math.sin(a + math.radians(jag / 3))))
        d.line(pts, fill=(120, 120, 150, 255), width=5)
    # violet gem shard set on the band, at the top
    gx, gy = cx + 4, cy - R - 6
    gem = [(gx, gy - 46), (gx + 30, gy - 6), (gx + 14, gy + 30), (gx - 18, gy + 26), (gx - 30, gy - 10)]
    d.polygon(gem, fill=(150, 40, 220, 255))
    d.polygon([(gx, gy - 46), (gx + 30, gy - 6), (gx + 2, gy - 2)], fill=(215, 150, 255, 255))
    d.polygon([(gx - 30, gy - 10), (gx, gy - 46), (gx + 2, gy - 2)], fill=(185, 95, 245, 255))
    d.polygon([(gx - 18, gy + 26), (gx + 14, gy + 30), (gx + 2, gy - 2)], fill=(95, 20, 160, 255))
    lay = lay.filter(ImageFilter.GaussianBlur(0.7))
    outline_paste(base, lay, color=(15, 5, 30, 255))
    hl = Image.new('RGBA', (S, S), (0, 0, 0, 0)); hd = ImageDraw.Draw(hl)
    hd.arc([cx - R + 8, cy - R + 8, cx + R - 8, cy + R - 8], 200, 300, fill=(255, 255, 255, 150), width=4)
    for (sx, sy, r) in [(gx - 8, gy - 26, 8), (210, 210, 7), (70, 120, 6)]:
        hd.polygon([(sx, sy - r * 2), (sx + r * 0.5, sy - r * 0.5), (sx + r * 2, sy), (sx + r * 0.5, sy + r * 0.5),
                    (sx, sy + r * 2), (sx - r * 0.5, sy + r * 0.5), (sx - r * 2, sy), (sx - r * 0.5, sy - r * 0.5)], fill=(255, 245, 255, 235))
    base.alpha_composite(hl)
    return frame(base)

icons = [feather(), ring_shard()]
os.makedirs(OUT, exist_ok=True)
for i, ic in enumerate(icons):
    ic.save(os.path.join(OUT, 'icon_%d_big.png' % i))

# sheets
sheet = Image.new('RGBA', (512, 256), (0, 0, 0, 255))
hd = Image.new('RGB', (1024, 512), (0, 0, 0))
for i, ic in enumerate(icons):
    sheet.paste(ranframe.cell(ic, 1).convert('RGBA'), (i * 35, 0))
    hd.paste(ranframe.cell(ic, 2), (i * 70, 0))
hd.save(os.path.join(OUT, 'eventexchange01.png'))

# DDS: copy commercialset07.dds's header (512x256, 32-bit ARGB, 1 level), RGBA byte order (read from its masks)
ref = open(os.path.join(TEX, 'gui', 'commercialset07.dds'), 'rb').read()
head = ref[:128]
px = sheet.tobytes('raw', 'RGBA')   # masks R=0xff..A=0xff000000: bytes R,G,B,A
assert len(ref) == 128 + len(px), (len(ref), len(px))
open(os.path.join(OUT, 'eventexchange01.dds'), 'wb').write(head + px)
chk = Image.open(os.path.join(OUT, 'eventexchange01.dds')).convert('RGBA')
assert chk.size == (512, 256) and chk.getpixel((17, 17)) == sheet.getpixel((17, 17)), 'dds read back'
prev = Image.new('RGB', (2 * 290 + 2 * 150, 290), (30, 30, 30))
for i, ic in enumerate(icons):
    prev.paste(ic.convert('RGB'), (i * 290, 0))
    prev.paste(ranframe.cell(ic, 2).resize((140, 140), Image.NEAREST), (580 + i * 150, 0))
    prev.paste(ranframe.cell(ic, 1).resize((140, 140), Image.NEAREST), (580 + i * 150, 150))
prev.save(os.path.join(OUT, 'icons_preview.png'))
print('ok')
