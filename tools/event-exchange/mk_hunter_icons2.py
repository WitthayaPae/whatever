# Daily Hunter icons, v2 (2026-10-26): the game's painted icons as the base, re-worked into
# our own set. Shared motif: the Daily Hunter crossed swords.
#   0 coin      game gold coin (supplies_set 12,5), face smoothed, crossed swords embossed, red glow
#   1 box       game "?" box (_update_icon_14 1,0) re-coloured crimson + gold, emblem on the front
#   2 card      game gold ticket (_update00 2,2) + a small hunter belt buckle + red wax seal
#   3-6 belts   game ornate belt (new_accessory_set_00 11,2), background re-hued per stat and a
#               cut gem set in the buckle: red attack, blue energy, green hit rate, violet avoid
# Pictures are built at 280 px from the gui_hd cells, then framed with ranframe (the game frame).
#   py mk_hunter_icons2.py <CLIENT/textures dir>
# Rewrites gui/dailyhunter01.dds (same header / byte layout) and gui_hd/dailyhunter01.png, cells 0-6.
import sys, os, math, colorsys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import ranframe
from PIL import Image, ImageDraw, ImageFilter, ImageChops

TEX = sys.argv[1]
N = 280

def base(sheet, x, y):
    im = Image.open(os.path.join(TEX, 'gui_hd', sheet + '.png')).convert('RGB')
    return im.crop((x * 70 + 6, y * 70 + 6, x * 70 + 64, y * 70 + 64)).resize((N, N), Image.LANCZOS)

def hsv_map(im, fn, mask=None):
    im = im.copy(); px = im.load(); mp = mask.load() if mask else None
    for y in range(N):
        for x in range(N):
            if mp and mp[x, y] == 0: continue
            r, g, b = px[x, y]
            h, s, v = colorsys.rgb_to_hsv(r / 255, g / 255, b / 255)
            o = fn(h, s, v)
            if o is None: continue
            r, g, b = colorsys.hsv_to_rgb(*o)
            px[x, y] = (round(r * 255), round(g * 255), round(b * 255))
    return im

def swords_mask(cx, cy, size, w=None):
    """Crossed swords, points up, as an L mask (N x N)."""
    m = Image.new('L', (N, N), 0); d = ImageDraw.Draw(m)
    w = w or max(4, size * 0.13)
    for sgn in (1, -1):
        a = math.radians(45 * sgn)
        ux, uy = math.sin(a), -math.cos(a)            # blade direction (up, tilted)
        px_, py_ = -uy, ux                            # perpendicular
        tip = (cx + ux * size, cy + uy * size)
        hb = (cx - ux * size * 0.45, cy - uy * size * 0.45)   # blade base / guard
        bl = [(hb[0] + px_ * w / 2, hb[1] + py_ * w / 2), (tip[0] - ux * w + px_ * w / 2, tip[1] - uy * w + py_ * w / 2),
              tip, (tip[0] - ux * w - px_ * w / 2, tip[1] - uy * w - py_ * w / 2), (hb[0] - px_ * w / 2, hb[1] - py_ * w / 2)]
        d.polygon(bl, fill=255)
        g = w * 1.9                                    # guard
        d.line([(hb[0] + px_ * g, hb[1] + py_ * g), (hb[0] - px_ * g, hb[1] - py_ * g)], fill=255, width=int(w * 0.8))
        he = (hb[0] - ux * size * 0.38, hb[1] - uy * size * 0.38)  # grip
        d.line([hb, he], fill=255, width=int(w * 0.75))
        r = w * 0.7
        d.ellipse([he[0] - r, he[1] - r, he[0] + r, he[1] + r], fill=255)
    return m

def emboss(im, mask, fill, light=(255, 245, 210), dark=(60, 30, 10), depth=4):
    """Raised metal relief: shadow below-right, highlight above-left, shaded fill."""
    sh = ImageChops.offset(mask, depth, depth).filter(ImageFilter.GaussianBlur(depth * 0.6))
    hl = ImageChops.offset(mask, -depth // 2, -depth // 2).filter(ImageFilter.GaussianBlur(1))
    im = Image.composite(Image.new('RGB', im.size, dark), im, sh.point(lambda v: v * 0.75))
    im = Image.composite(Image.new('RGB', im.size, light), im, hl)
    grad = Image.linear_gradient('L').resize(im.size)              # top light, bottom darker
    top = Image.new('RGB', im.size, tuple(min(255, int(c * 1.18)) for c in fill))
    bot = Image.new('RGB', im.size, tuple(int(c * 0.72) for c in fill))
    shade = Image.composite(bot, top, grad)
    inner = mask.filter(ImageFilter.MinFilter(3))
    return Image.composite(shade, im, inner)

def glow(im, cx, cy, r, col, strength=0.55, keep=None):
    g = Image.new('L', (N, N), 0)
    ImageDraw.Draw(g).ellipse([cx - r, cy - r, cx + r, cy + r], fill=255)
    g = g.filter(ImageFilter.GaussianBlur(r * 0.45)).point(lambda v: int(v * strength))
    if keep is not None: g = ImageChops.subtract(g, keep)
    return Image.composite(Image.new('RGB', (N, N), col), im, g)

def sparkle(im, pts, col=(255, 250, 225)):
    d = ImageDraw.Draw(im)
    for x, y, s in pts:
        d.polygon([(x, y - s), (x + s * 0.22, y - s * 0.22), (x + s, y), (x + s * 0.22, y + s * 0.22),
                   (x, y + s), (x - s * 0.22, y + s * 0.22), (x - s, y), (x - s * 0.22, y - s * 0.22)], fill=col)
    return im

def gem(im, cx, cy, r, col):
    """Faceted cut gem in a gold bezel."""
    d = ImageDraw.Draw(im)
    d.ellipse([cx - r - 7, cy - r - 7, cx + r + 7, cy + r + 7], fill=(70, 45, 10))
    d.ellipse([cx - r - 5, cy - r - 5, cx + r + 5, cy + r + 5], fill=(225, 180, 70))
    d.ellipse([cx - r - 1, cy - r - 1, cx + r + 1, cy + r + 1], fill=(120, 80, 20))
    h, s, v = colorsys.rgb_to_hsv(*[c / 255 for c in col])
    for k in range(r, 0, -1):                                    # body: dark rim to bright core
        t = k / r
        rr, gg, bb = colorsys.hsv_to_rgb(h, min(1, s * (0.75 + 0.35 * t)), min(1, v * (1.25 - 0.6 * t)))
        ox, oy = (1 - t) * -r * 0.18, (1 - t) * -r * 0.18
        d.ellipse([cx + ox - k, cy + oy - k, cx + ox + k, cy + oy + k], fill=(int(rr * 255), int(gg * 255), int(bb * 255)))
    pts = [(cx + r * 0.55 * math.cos(math.radians(a)), cy + r * 0.55 * math.sin(math.radians(a))) for a in range(-90, 270, 45)]
    lite = tuple(min(255, int(c * 0.5 + 140)) for c in col)
    d.polygon(pts, outline=lite)
    for (x, y) in pts:                                           # facet lines out to the rim
        a = math.atan2(y - cy, x - cx)
        d.line([(x, y), (cx + r * 0.95 * math.cos(a), cy + r * 0.95 * math.sin(a))], fill=lite, width=1)
    d.ellipse([cx - r * 0.55, cy - r * 0.62, cx - r * 0.1, cy - r * 0.3], fill=(255, 255, 255))   # glint
    return sparkle(im, [(cx + r * 0.45, cy - r * 0.55, r * 0.45)])

# ---------- 0 coin
def coin():
    im = base('supplies_set', 12, 5)
    m = Image.new('L', (N, N), 0); mp = m.load(); px = im.load()
    for y in range(N):
        for x in range(N):
            r, g, b = px[x, y]; h, s, v = colorsys.rgb_to_hsv(r / 255, g / 255, b / 255)
            if 0.08 < h < 0.2 and s > 0.3 and v > 0.45: mp[x, y] = 255
    m = m.filter(ImageFilter.MaxFilter(5)).filter(ImageFilter.MinFilter(15))      # coin face, rim excluded
    smooth = im.filter(ImageFilter.GaussianBlur(14))
    im = Image.composite(smooth, im, m.filter(ImageFilter.GaussianBlur(3)))
    # warmer, richer gold
    im = hsv_map(im, lambda h, s, v: (0.115, min(1, s * 1.15), min(1, v * 1.05)) if 0.06 < h < 0.22 and s > 0.25 else None)
    # dark background -> deep red glow behind the coin
    bgm = ImageChops.invert(m.filter(ImageFilter.MaxFilter(25)))
    im = glow(im, 140, 150, 150, (150, 25, 15), 0.6, keep=ImageChops.invert(bgm))
    sw = swords_mask(136, 150, 96, 20)
    im = emboss(im, sw, (225, 165, 40), dark=(90, 45, 5), depth=5)
    return sparkle(im, [(230, 70, 22), (70, 235, 14)])

# ---------- 1 box
def box():
    im = base('_update_icon_14', 1, 0)
    def f(h, s, v):
        if 0.5 < h < 0.75 and s > 0.25: return (0.995, min(1, s * 1.1), v * 0.85)       # blue box -> crimson
        if 0.03 < h < 0.16 and s > 0.3: return (0.13, min(1, s * 0.95), min(1, v * 1.1)) # orange ? -> gold
        if s < 0.18: return (0.09, 0.35 * (v), v * 0.92)                                  # grey glow -> amber
        return None
    im = hsv_map(im, f)
    sw = swords_mask(150, 218, 42, 10)
    im = emboss(im, sw, (245, 200, 80), dark=(50, 5, 5), depth=3)
    return sparkle(im, [(235, 60, 20), (40, 110, 13), (250, 230, 11)])

# ---------- 3-6 belts
BELT = [((0.0, 1.15), (225, 30, 35)), ((0.60, 1.0), (40, 110, 240)), ((0.33, 1.0), (40, 200, 70)), ((0.78, 1.0), (165, 60, 230))]
def belt(k, small=False):
    im = base('new_accessory_set_00', 11, 2)
    (hue, ks), gc = BELT[k]
    im = hsv_map(im, lambda h, s, v: (hue, min(1, s * ks), v) if s >= 0.22 and v >= 0.06 else None)
    im = glow(im, 140, 155, 60, gc, 0.35)
    return gem(im, 140, 150, 38, gc)

# ---------- 2 card
def card():
    im = base('_update00', 2, 2)
    im = hsv_map(im, lambda h, s, v: (0.11, min(1, s * 0.9), v) if 0.0 <= h < 0.2 and s > 0.35 else
                 ((0.09, 0.3 * v, v * 0.85) if s < 0.15 else None))
    # the hunter buckle on the ticket, turned to the ticket's angle, with a soft shadow
    b = base('new_accessory_set_00', 11, 2)
    b = hsv_map(b, lambda h, s, v: (0.0, min(1, s * 1.15), v * 0.8) if s >= 0.22 and v >= 0.06 else None)
    b = b.crop((20, 40, 270, 250)).resize((120, 100), Image.LANCZOS).convert('RGBA')
    bm = Image.new('L', b.size, 0); ImageDraw.Draw(bm).rounded_rectangle([2, 2, 117, 97], 14, fill=255)
    b.putalpha(bm.filter(ImageFilter.GaussianBlur(1.5)))
    ImageDraw.Draw(b).rounded_rectangle([2, 2, 117, 97], 14, outline=(225, 180, 70, 255), width=4)
    b = b.rotate(28, expand=True, resample=Image.BICUBIC)
    sh = Image.new('RGBA', b.size, (40, 20, 0, 0)); sh.putalpha(b.getchannel('A').point(lambda v: v * 0.6))
    im = im.convert('RGBA')
    im.alpha_composite(sh.filter(ImageFilter.GaussianBlur(4)), (118, 82))
    im.alpha_composite(b, (110, 74))
    im = im.convert('RGB')
    d = ImageDraw.Draw(im)                                           # red wax seal, lower left
    cx, cy, r = 92, 210, 40
    d.ellipse([cx - r - 3, cy - r - 1, cx + r + 4, cy + r + 5], fill=(70, 5, 5))
    d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=(185, 25, 25))
    d.ellipse([cx - r + 6, cy - r + 5, cx + r - 8, cy + r - 9], fill=(205, 40, 35))
    im = emboss(im, swords_mask(cx, cy + 4, 26, 6), (240, 80, 70), light=(255, 170, 160), dark=(80, 5, 5), depth=2)
    return sparkle(im, [(240, 50, 18), (200, 250, 12)])

icons = {0: coin(), 1: box(), 2: card()}
for k in range(4): icons[3 + k] = belt(k)

sd_path = os.path.join(TEX, 'gui', 'dailyhunter01.dds')
hd_path = os.path.join(TEX, 'gui_hd', 'dailyhunter01.png')
raw = open(sd_path, 'rb').read()
before = Image.open(sd_path).convert('RGBA')
sd = before.copy()
hd = Image.open(hd_path).convert('RGB')
for c, ic in icons.items():
    sd.paste(ranframe.cell(ic, 1).convert('RGBA'), (c * 35, 0))
    hd.paste(ranframe.cell(ic, 2), (c * 70, 0))
px = sd.tobytes('raw', 'RGBA')
assert len(raw) == 128 + len(px)
open(sd_path, 'wb').write(raw[:128] + px)
chk = Image.open(sd_path).convert('RGBA')
assert chk.getpixel((4 * 35 + 17, 17)) == sd.getpixel((4 * 35 + 17, 17)), 'dds read back'
assert chk.crop((245, 0, 512, 256)).tobytes() == before.crop((245, 0, 512, 256)).tobytes(), 'unused area changed'
hd.save(hd_path)
if len(sys.argv) > 2:                                               # preview: big picture, SD cell, HD cell
    prev = Image.new('RGB', (7 * 290, 590), (30, 30, 30))
    for c, ic in icons.items():
        prev.paste(ic, (c * 290, 0))
        prev.paste(ranframe.cell(ic, 1).resize((140, 140), Image.NEAREST), (c * 290, 300))
        prev.paste(ranframe.cell(ic, 2).resize((140, 140), Image.LANCZOS), (c * 290 + 145, 300))
        prev.paste(ranframe.cell(ic, 1), (c * 290, 450)); prev.paste(ranframe.cell(ic, 2), (c * 290 + 40, 450))
    prev.save(sys.argv[2])
print('ok')
