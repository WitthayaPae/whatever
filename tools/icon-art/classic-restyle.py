"""Put the newer menu icons into the classic icons' look.

The menu and the top icon row use the PC's own art for the old windows
(icons_classic.png: sepia figures, a grey bevel and a thick black frame).
The windows added later - party finder, ranking, competition, boss, auction,
item shop, crafting, Q box, GM, settings, exit - were drawn flat grey with a
rounded plate and no black frame, so the row looked like two sets (the user,
2026-10-09).

This takes each of those cells from mobile_icons.dds, cuts its own plate
off, tones the glyph into the classic sepia ramp, and puts it inside the
frame copied from a classic cell. The classic cells are left as they are.

    python classic-restyle.py <in.png> <out.png>
    node topdds.js ../../../CLIENT/textures/gui/mobile_icons.dds <out.png>
"""
import sys
from PIL import Image, ImageFilter

N = 128
FRAME_FROM = 1          # the character cell: a clean classic frame
INNER = 13              # the classic frame's width (bevel + black)
RESTYLE = [8, 9, 10, 12, 13, 14, 15, 16, 17, 18, 23, 25, 26, 27]
NO_RIM = [8, 9, 10, 15, 18]   # pictures, not flat glyphs: tone only
FRAME_ONLY = [24]       # classic art already, only its frame differs
PLATE_CUT = 14          # the flat icons' own rounded plate

# Sepia ramp sampled from the classic cells: shadow, body, highlight.
RAMP = [(0.00, (24, 20, 17)), (0.30, (92, 80, 66)), (0.55, (150, 128, 98)),
        (0.80, (214, 186, 140)), (1.00, (246, 228, 190))]


def ramp(v):
    for (a, ca), (b, cb) in zip(RAMP, RAMP[1:]):
        if v <= b:
            t = (v - a) / (b - a) if b > a else 0
            return tuple(int(ca[i] + (cb[i] - ca[i]) * t) for i in range(3))
    return RAMP[-1][1]


def cell(im, n):
    x, y = (n % 8) * N, (n // 8) * N
    return im.crop((x, y, x + N, y + N))


def main(src, dst):
    im = Image.open(src).convert('RGBA')
    frame = cell(im, FRAME_FROM)
    fpx = frame.load()
    for n in RESTYLE:
        c = cell(im, n)
        # the glyph, without the flat plate, stretched contrast
        inner = c.crop((PLATE_CUT, PLATE_CUT, N - PLATE_CUT, N - PLATE_CUT)).convert('RGB')
        lum = inner.convert('L')
        lo, hi = lum.getextrema()
        span = max(1, hi - lo)
        size = N - INNER * 2
        lum = lum.resize((size, size), Image.LANCZOS)
        # a dark outline round the light glyph, as the classic figures have
        #	the glyph mask, cleaned of specks, and the band just outside it
        soft = lum.filter(ImageFilter.GaussianBlur(0.0 if n in NO_RIM else 1.2))
        glyph = soft.point(lambda p: 255 if p > lo + span * 0.55 else 0).filter(ImageFilter.MedianFilter(5))
        rim = glyph.filter(ImageFilter.MaxFilter(5))
        body = Image.new('RGB', (size, size))
        bp, lp, gp, rp = body.load(), soft.load(), glyph.load(), rim.load()
        for yy in range(size):
            for xx in range(size):
                v = (lp[xx, yy] - lo) / span
                v = 0.0 if v < 0 else ( 1.0 if v > 1 else v )
                col = ramp(0.18 + v * 0.82)
                if n not in NO_RIM and rp[xx, yy] and not gp[xx, yy]:
                    col = tuple(int(k * 0.30) for k in col)
                bp[xx, yy] = col
        out = frame.copy()
        out.paste(body.convert('RGBA'), (INNER, INNER))
        # keep the classic frame's own pixels on top (its inner shadow)
        op = out.load()
        for yy in range(N):
            for xx in range(N):
                if min(xx, yy, N - 1 - xx, N - 1 - yy) < INNER:
                    op[xx, yy] = fpx[xx, yy]
        im.paste(out, ((n % 8) * N, (n // 8) * N))
        print('restyled cell', n)
    for n in FRAME_ONLY:
        out = cell(im, n)
        op = out.load()
        for yy in range(N):
            for xx in range(N):
                if min(xx, yy, N - 1 - xx, N - 1 - yy) < INNER:
                    op[xx, yy] = fpx[xx, yy]
        im.paste(out, ((n % 8) * N, (n // 8) * N))
        print('reframed cell', n)
    im.save(dst)


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
