# Daily Hunter belt icons (cells 3-6 of dailyhunter01) made from the game's own belt icon,
# so they match the other belts: New_Accessory_set_00 cell (11,2), the ornate silver buckle
# (1997/3), frame included. Only the coloured background is re-hued per stat; the silver
# buckle (low saturation) is left as it is.
#   py mk_belts_game.py <CLIENT/textures dir>
# Rewrites gui/dailyhunter01.dds (same header, same byte layout) and gui_hd/dailyhunter01.png.
import sys, os, colorsys
from PIL import Image

TEX = sys.argv[1]
SRC, SX, SY = 'New_Accessory_set_00', 11, 2
# cell -> (hue 0..1, saturation scale)
TARGET = {3: (0.0, 1.15),     # attack: red
          4: (0.60, 1.0),     # energy: blue
          5: (0.33, 1.0),     # hit rate: green (the source colour)
          6: (0.78, 1.0)}     # avoid: violet

def recolour(cell, hue, ks):
    px = cell.load()
    w, h = cell.size
    for y in range(h):
        for x in range(w):
            p = px[x, y]
            r, g, b = p[0] / 255, p[1] / 255, p[2] / 255
            hh, ss, vv = colorsys.rgb_to_hsv(r, g, b)
            if ss < 0.22 or vv < 0.06:
                continue                       # silver buckle, frame, black: keep
            r, g, b = colorsys.hsv_to_rgb(hue, min(1.0, ss * ks), vv)
            px[x, y] = (round(r * 255), round(g * 255), round(b * 255)) + tuple(p[3:])
    return cell

def build(sheet_path, src_path, s):
    src = Image.open(src_path).convert('RGBA')
    sheet = Image.open(sheet_path).convert('RGBA')
    base = src.crop((SX * s, SY * s, SX * s + s, SY * s + s))
    for c, (hue, ks) in TARGET.items():
        sheet.paste(recolour(base.copy(), hue, ks), (c * s, 0))
    return sheet

sd_path = os.path.join(TEX, 'gui', 'dailyhunter01.dds')
sd = build(sd_path, os.path.join(TEX, 'gui', SRC + '.dds'), 35)
raw = open(sd_path, 'rb').read()
px = sd.tobytes('raw', 'RGBA')
assert len(raw) == 128 + len(px)
before = Image.open(sd_path).convert('RGBA')
open(sd_path, 'wb').write(raw[:128] + px)
chk = Image.open(sd_path).convert('RGBA')
assert chk.size == (512, 256) and chk.getpixel((4 * 35 + 17, 17)) == sd.getpixel((4 * 35 + 17, 17)), 'dds read back'
assert chk.crop((0, 0, 105, 35)).tobytes() == before.crop((0, 0, 105, 35)).tobytes(), 'cells 0-2 changed'

hd_path = os.path.join(TEX, 'gui_hd', 'dailyhunter01.png')
hd = build(hd_path, os.path.join(TEX, 'gui_hd', SRC + '.png'), 70)
hd.convert('RGB').save(hd_path)
print('ok')
