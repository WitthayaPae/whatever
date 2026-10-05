import os, math
import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont
D = os.path.dirname(os.path.abspath(__file__)); OUT = D + '/art'
SS = 4

def radial(n, stops):
    y, x = np.mgrid[0:n, 0:n]; c = (n - 1) / 2
    r = np.sqrt((x - c) ** 2 + (y - c) ** 2) / c
    out = np.zeros((n, n, 4), np.float32)
    rs = [s[0] for s in stops]; cols = np.array([s[1] for s in stops], np.float32)
    for ch in range(4): out[..., ch] = np.interp(r, rs, cols[:, ch])
    return out

def lin(n, top, bot):
    t = (np.mgrid[0:n, 0:n][0] / (n - 1))[..., None]
    return np.array(top, np.float32) * (1 - t) + np.array(bot, np.float32) * t

def cmask(n, r0, r1=None, cx=None, cy=None):
    y, x = np.mgrid[0:n, 0:n]
    cx = (n - 1) / 2 if cx is None else cx; cy = (n - 1) / 2 if cy is None else cy
    d = np.sqrt((x - cx) ** 2 + (y - cy) ** 2)
    m = np.clip(r0 - d + 0.5, 0, 1)
    if r1 is not None: m = m * np.clip(d - r1 + 0.5, 0, 1)
    return m

def over(dst, src):
    a = src[..., 3:4] / 255.0; b = dst[..., 3:4] / 255.0
    oa = a + b * (1 - a)
    oc = np.where(oa > 0, (src[..., :3] * a + dst[..., :3] * b * (1 - a)) / np.maximum(oa, 1e-6), 0)
    return np.concatenate([oc, oa * 255], -1)

def layer(col, mask):
    col = np.array(col, np.float32) if not isinstance(col, np.ndarray) else col
    if col.ndim == 1: col = np.broadcast_to(col, mask.shape + (4,)).copy()
    out = col.copy(); out[..., 3] = col[..., 3] * mask; return out

def finish(arr, size):
    return Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8), 'RGBA').resize((size, size), Image.LANCZOS)

GOLD_T = (236, 236, 236, 255); GOLD_B = (150, 150, 150, 255)

def chrome(n, bright=1.0):
    t = np.mgrid[0:n, 0:n][0] / (n - 1)
    v = np.interp(t, [0, 0.42, 0.5, 0.56, 1.0], [235, 175, 58, 105, 205]) * bright
    out = np.zeros((n, n, 4), np.float32); out[..., 0] = v; out[..., 1] = v; out[..., 2] = v * 1.02; out[..., 3] = 255
    return np.clip(out, 0, 255)

def ornament(a, n, R, studs, lit):
    """engraved band inside the rim: a thin inner gold line, tick marks and four studs"""
    w = R * 0.075
    ri = R - w * 2.6
    a = over(a, layer(lin(n, (255, 230, 170, 200), (150, 104, 40, 200)), cmask(n, ri, ri - 1.6 * SS)))
    g = Image.new('L', (n, n), 0); d = ImageDraw.Draw(g); c = n / 2
    for k in range(48):
        t = k * math.pi / 24
        r0, r1 = R - w * 1.15, (R - w * 2.3) if k % 4 == 0 else (R - w * 1.7)
        d.line([(c + math.cos(t) * r0, c + math.sin(t) * r0), (c + math.cos(t) * r1, c + math.sin(t) * r1)], fill=150 if k % 4 else 230, width=max(1, int(1.2 * SS)))
    a = over(a, layer(lin(n, (255, 236, 190, 255), (170, 120, 50, 255)), np.asarray(g, np.float32) / 255.0 * 0.75))
    if studs:
        for q in range(4):
            t = q * math.pi / 2 - math.pi / 4 if studs == 2 else q * math.pi / 2
            cx, cy = c + math.cos(t) * (R - w * 0.5), c + math.sin(t) * (R - w * 0.5); s = w * 1.25
            gm = Image.new('L', (n, n), 0); ImageDraw.Draw(gm).polygon([(cx, cy - s), (cx + s, cy), (cx, cy + s), (cx - s, cy)], fill=255)
            m = np.asarray(gm, np.float32) / 255.0
            a = over(a, layer((0, 0, 0, 160), np.asarray(gm.filter(ImageFilter.GaussianBlur(2 * SS)), np.float32) / 255.0))
            a = over(a, layer(lin(n, (255, 250, 220, 255), (200, 130, 40, 255)) if not lit else lin(n, (255, 255, 230, 255), (255, 150, 30, 255)), m))
    return a

def disc(size, lit=False, glass=0.30, strength=1.0, orn=True, studs=0):
    n = size * SS; R = n / 2 - 6 * SS; yy = np.mgrid[0:n, 0:n][0]
    a = np.zeros((n, n, 4), np.float32)
    sh = Image.fromarray((cmask(n, R + 2 * SS) * 110).astype(np.uint8)).filter(ImageFilter.GaussianBlur(5 * SS))
    a = over(a, layer((0, 0, 0, 255), np.asarray(sh) / 255.0))
    body = radial(n, [(0, (34, 35, 32, int(255 * glass * 0.7))), (0.75, (28, 29, 27, int(255 * glass))),
                      (1.0, (12, 12, 12, int(255 * min(1, glass * 1.6))))])
    if lit: body = radial(n, [(0, (150, 150, 150, 170)), (0.8, (95, 95, 95, 190)), (1.0, (40, 40, 40, 220))])
    a = over(a, layer(body, cmask(n, R)))
    sm = cmask(n, R * 0.86, cy=(n - 1) / 2 - R * 0.18) * cmask(n, R * 0.92) * np.clip(((n / 2) - yy) / (R * 0.9), 0, 1)
    a = over(a, layer(lin(n, (255, 255, 255, 60), (255, 255, 255, 0)), sm))
    w = R * 0.085 * strength
    a = over(a, layer((0, 0, 0, 230), cmask(n, R + 1.5 * SS, R - w - 1.5 * SS)))
    a = over(a, layer(chrome(n, 1.12 if lit else 1.0), cmask(n, R, R - w)))
    if lit:
        g = Image.fromarray((cmask(n, R + 4 * SS, R - w) * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(7 * SS))
        a = over(layer((255, 255, 255, 200), np.asarray(g) / 255.0), a)
    return a

def emboss(mask_img, n):
    m = np.asarray(mask_img, np.float32) / 255.0
    sh = np.asarray(mask_img.filter(ImageFilter.GaussianBlur(3 * SS)), np.float32) / 255.0
    sh = np.roll(np.roll(sh, int(2 * SS), 0), int(SS), 1)
    a = layer((0, 0, 0, 210), sh)
    ol = np.asarray(mask_img.filter(ImageFilter.MaxFilter(3 * SS + 1)), np.float32) / 255.0
    a = over(a, layer((0, 0, 0, 240), ol))
    a = over(a, layer(lin(n, (255, 255, 255, 255), (205, 205, 205, 255)), m))
    er = np.asarray(mask_img.filter(ImageFilter.MinFilter(4 * SS + 1)), np.float32) / 255.0
    edge = np.clip(m - er, 0, 1); yy = np.mgrid[0:n, 0:n][0] / n
    a = over(a, layer((120, 120, 120, 255), edge * np.clip(yy * 1.6 - 0.3, 0, 1) * 0.7))
    return a

def glyph(kind, n):
    im = Image.new('L', (n, n), 0); d = ImageDraw.Draw(im); c = n / 2; u = n / 256; W = 255
    if kind == 'sword':
        d.polygon([(c - 11 * u, c - 80 * u), (c, c - 104 * u), (c + 11 * u, c - 80 * u), (c + 11 * u, c + 28 * u), (c - 11 * u, c + 28 * u)], fill=W)
        d.line([(c, c - 96 * u), (c, c + 24 * u)], fill=150, width=int(3 * u))
        d.rounded_rectangle((c - 50 * u, c + 26 * u, c + 50 * u, c + 40 * u), int(6 * u), fill=W)
        d.rounded_rectangle((c - 8 * u, c + 40 * u, c + 8 * u, c + 80 * u), int(4 * u), fill=W)
        d.ellipse((c - 15 * u, c + 76 * u, c + 15 * u, c + 104 * u), fill=W)
    elif kind == 'chat':
        d.rounded_rectangle((c - 62 * u, c - 46 * u, c + 62 * u, c + 34 * u), int(26 * u), fill=W)
        d.polygon([(c - 32 * u, c + 28 * u), (c - 6 * u, c + 28 * u), (c - 42 * u, c + 66 * u)], fill=W)
        for dx in (-32, 0, 32): d.ellipse((c + (dx - 10) * u, c - 16 * u, c + (dx + 10) * u, c + 4 * u), fill=0)
    elif kind == 'grid':
        for i in (-1, 1):
            for j in (-1, 1):
                d.rounded_rectangle((c + i * 30 * u - 22 * u, c + j * 30 * u - 22 * u, c + i * 30 * u + 22 * u, c + j * 30 * u + 22 * u), int(8 * u), fill=W)
    elif kind == 'lock':
        d.rounded_rectangle((c - 40 * u, c - 6 * u, c + 40 * u, c + 56 * u), int(10 * u), fill=W)
        d.arc((c - 28 * u, c - 58 * u, c + 28 * u, c + 10 * u), 180, 360, fill=W, width=int(13 * u))
        for s in (-1, 1): d.line([(c + s * 28 * u, c - 26 * u), (c + s * 28 * u, c - 4 * u)], fill=W, width=int(13 * u))
        d.ellipse((c - 9 * u, c + 12 * u, c + 9 * u, c + 30 * u), fill=0); d.rectangle((c - 4 * u, c + 24 * u, c + 4 * u, c + 42 * u), fill=0)
    elif kind == 'pk':
        for s in (1, -1):
            d.line([(c - 50 * s * u, c - 50 * u), (c + 38 * s * u, c + 38 * u)], fill=W, width=int(14 * u))
            d.polygon([(c - 46 * s * u, c - 56 * u), (c - 64 * s * u, c - 64 * u), (c - 56 * s * u, c - 46 * u)], fill=W)
            d.line([(c + 18 * s * u, c + 52 * u), (c + 52 * s * u, c + 18 * u)], fill=W, width=int(11 * u))
            d.ellipse((c + (44 * s - 9) * u, c + 41 * u, c + (44 * s + 9) * u, c + 59 * u), fill=W)
    elif kind == 'auto':
        d.ellipse((c - 50 * u, c - 50 * u, c + 50 * u, c + 50 * u), outline=W, width=int(11 * u))
        d.ellipse((c - 13 * u, c - 13 * u, c + 13 * u, c + 13 * u), fill=W)
        for q in range(4):
            t = q * math.pi / 2
            d.line([(c + math.cos(t) * 30 * u, c + math.sin(t) * 30 * u), (c + math.cos(t) * 70 * u, c + math.sin(t) * 70 * u)], fill=W, width=int(11 * u))
    elif kind == 'fist':
        # front view of a clenched fist: knuckle row, folded fingers, thumb across, wrist
        for k in range(4):
            x0 = c - 50 * u + k * 25 * u
            d.rounded_rectangle((x0, c - 52 * u + (6 if k in (0, 3) else 0) * u, x0 + 26 * u, c + 2 * u), int(12 * u), fill=W)
        d.rounded_rectangle((c - 52 * u, c - 18 * u, c + 52 * u, c + 40 * u), int(18 * u), fill=W)
        for k in range(1, 4):
            x0 = c - 50 * u + k * 25 * u
            d.line([(x0, c - 44 * u), (x0, c - 12 * u)], fill=0, width=max(2, int(4 * u)))
        d.line([(c - 46 * u, c - 14 * u), (c + 46 * u, c - 14 * u)], fill=0, width=max(2, int(3 * u)))
        d.rounded_rectangle((c - 60 * u, c + 2 * u, c + 14 * u, c + 26 * u), int(12 * u), fill=0)
        d.rounded_rectangle((c - 57 * u, c + 5 * u, c + 11 * u, c + 23 * u), int(9 * u), fill=W)
        d.rounded_rectangle((c - 30 * u, c + 38 * u, c + 34 * u, c + 72 * u), int(8 * u), fill=W)
        d.line([(c - 30 * u, c + 42 * u), (c + 34 * u, c + 42 * u)], fill=0, width=max(2, int(3 * u)))
    elif kind == 'pickup':
        # a hand coming down over a coin, fingers curled to take it
        def stroke(pts, wd):
            pts = [(c + x * u, c + y * u) for x, y in pts]
            d.line(pts, fill=W, width=int(wd * u), joint='curve')
            for (x, y) in (pts[0], pts[-1]):
                r = wd * u / 2; d.ellipse((x - r, y - r, x + r, y + r), fill=W)
        d.ellipse((c - 48 * u, c + 40 * u, c + 48 * u, c + 78 * u), fill=W)
        d.ellipse((c - 36 * u, c + 46 * u, c + 36 * u, c + 72 * u), outline=0, width=max(2, int(4 * u)))
        pts = []
        for q in range(10):
            t = q * math.pi / 5 - math.pi / 2; rr = (10 if q % 2 == 0 else 4.5) * u
            pts.append((c + math.cos(t) * rr * 1.5, c + 59 * u + math.sin(t) * rr))
        d.polygon(pts, fill=0)
        d.ellipse((c - 38 * u, c - 74 * u, c + 34 * u, c - 14 * u), fill=W)          # back of the hand
        d.rectangle((c - 16 * u, c - 98 * u, c + 22 * u, c - 56 * u), fill=W)          # wrist
        for k, (x, bend) in enumerate(((-28, 10), (-10, 14), (8, 14), (24, 9))):        # fingers, curling in
            stroke([(x, -36), (x - 2, -6), (x + bend * 0.3, 12), (x + bend, 22)], 15)
        for k in range(3):
            x = -19 + k * 18
            d.line([(c + x * u, c - 30 * u), (c + x * u, c + 4 * u)], fill=0, width=max(2, int(3 * u)))
        stroke([(-32, -40), (-50, -22), (-46, 0), (-34, 10)], 16)                     # thumb
    elif kind == 'pick_a':
        # open hand, palm out, fingers spread: "grab"
        for x, top, wd in ((-34, -66, 18), (-12, -82, 19), (10, -80, 19), (31, -62, 17)):
            d.rounded_rectangle((c + (x - wd / 2) * u, c + top * u, c + (x + wd / 2) * u, c + 6 * u), int(wd / 2 * u), fill=W)
        d.rounded_rectangle((c - 44 * u, c - 16 * u, c + 42 * u, c + 70 * u), int(34 * u), fill=W)
        d.polygon([(c - 40 * u, c + 6 * u), (c - 70 * u, c - 30 * u), (c - 56 * u, c - 44 * u), (c - 28 * u, c - 12 * u)], fill=W)
        d.ellipse((c - 72 * u, c - 50 * u, c - 50 * u, c - 26 * u), fill=W)
        for x in (-23, -1, 21):
            d.line([(c + x * u, c - 40 * u), (c + x * u, c - 4 * u)], fill=0, width=max(2, int(3 * u)))
    elif kind == 'pick_b':
        # loot sack with an arrow going in
        d.rectangle((c - 8 * u, c - 98 * u, c + 8 * u, c - 58 * u), fill=W)
        d.polygon([(c - 28 * u, c - 62 * u), (c + 28 * u, c - 62 * u), (c, c - 34 * u)], fill=W)
        d.ellipse((c - 62 * u, c - 2 * u, c + 62 * u, c + 92 * u), fill=W)
        d.polygon([(c - 26 * u, c + 10 * u), (c - 40 * u, c - 14 * u), (c + 40 * u, c - 14 * u), (c + 26 * u, c + 10 * u)], fill=W)
        d.line([(c - 30 * u, c + 8 * u), (c + 30 * u, c + 8 * u)], fill=0, width=max(2, int(5 * u)))
        pts = []
        for q in range(10):
            t = q * math.pi / 5 - math.pi / 2; rr = (16 if q % 2 == 0 else 7) * u
            pts.append((c + math.cos(t) * rr, c + 52 * u + math.sin(t) * rr))
        d.polygon(pts, fill=0)
    elif kind == 'pick_c':
        # cupped hand lifting a gem
        d.polygon([(c, c - 84 * u), (c + 30 * u, c - 54 * u), (c, c - 14 * u), (c - 30 * u, c - 54 * u)], fill=W)
        d.line([(c - 30 * u, c - 54 * u), (c + 30 * u, c - 54 * u)], fill=0, width=max(2, int(3 * u)))
        d.line([(c, c - 84 * u), (c, c - 14 * u)], fill=0, width=max(2, int(2 * u)))
        for (sx, sy, r) in ((-48, -78, 10), (46, -86, 8), (52, -40, 6)):
            d.polygon([(c + sx * u, c + (sy - r) * u), (c + (sx + r * 0.3) * u, c + sy * u), (c + sx * u, c + (sy + r) * u), (c + (sx - r * 0.3) * u, c + sy * u)], fill=W)
            d.polygon([(c + (sx - r) * u, c + sy * u), (c + sx * u, c + (sy - r * 0.3) * u), (c + (sx + r) * u, c + sy * u), (c + sx * u, c + (sy + r * 0.3) * u)], fill=W)
        d.chord((c - 70 * u, c - 30 * u, c + 70 * u, c + 70 * u), 0, 180, fill=W)
        d.rounded_rectangle((c - 72 * u, c + 4 * u, c - 40 * u, c + 22 * u), int(9 * u), fill=W)
        for k in range(4):
            y = c + (24 + k * 0) * u
        for x in (-30, -6, 18, 42):
            d.line([(c + x * u, c + 22 * u), (c + (x - 4) * u, c + 52 * u)], fill=0, width=max(2, int(3 * u)))
        d.rectangle((c - 22 * u, c + 66 * u, c + 40 * u, c + 94 * u), fill=W)
    elif kind == 'bike':
        for s in (-1, 1):
            d.ellipse((c + (52 * s - 28) * u, c + 4 * u, c + (52 * s + 28) * u, c + 60 * u), outline=W, width=int(12 * u))
            d.ellipse((c + (52 * s - 7) * u, c + 25 * u, c + (52 * s + 7) * u, c + 39 * u), fill=W)
        d.polygon([(c - 52 * u, c + 32 * u), (c - 34 * u, c - 6 * u), (c + 20 * u, c - 6 * u), (c + 40 * u, c + 12 * u), (c + 8 * u, c + 34 * u), (c - 24 * u, c + 34 * u)], fill=W)
        d.rounded_rectangle((c - 44 * u, c - 22 * u, c - 2 * u, c - 6 * u), int(6 * u), fill=W)
        d.line([(c + 22 * u, c - 6 * u), (c + 40 * u, c - 40 * u), (c + 58 * u, c - 44 * u)], fill=W, width=int(10 * u))
        d.line([(c + 40 * u, c - 30 * u), (c + 52 * u, c + 32 * u)], fill=W, width=int(9 * u))
    return im

def button(kind, size=256, lit=False, glass=0.30, studs=0):
    n = size * SS; a = disc(size, lit=lit, glass=glass, studs=studs)
    return finish(over(a, emboss(glyph(kind, n), n)), size)

def text_button(label, size=128, lit=False):
    n = size * SS; a = disc(size, lit=lit, glass=0.40, strength=1.3)
    g = Image.new('L', (n, n), 0); d = ImageDraw.Draw(g)
    f = ImageFont.truetype('tahomabd.ttf', int(n * 0.34))
    b = d.textbbox((0, 0), label, font=f)
    d.text(((n - (b[2] - b[0])) / 2 - b[0], (n - (b[3] - b[1])) / 2 - b[1]), label, font=f, fill=255)
    return finish(over(a, emboss(g, n)), size)

def joystick(size=512):
    n = size * SS; R = n / 2 - 8 * SS
    a = np.zeros((n, n, 4), np.float32)
    a = over(a, layer(radial(n, [(0, (34, 35, 32, 40)), (0.8, (28, 29, 27, 85)), (1, (12, 12, 12, 130))]), cmask(n, R)))
    w = R * 0.045
    a = over(a, layer((0, 0, 0, 230), cmask(n, R + 1.5 * SS, R - w - 1.5 * SS)))
    a = over(a, layer(chrome(n), cmask(n, R, R - w)))
    a = over(a, layer((255, 255, 255, 70), cmask(n, R * 0.72, R * 0.72 - 2 * SS)))
    g = Image.new('L', (n, n), 0); d = ImageDraw.Draw(g); c = n / 2
    for q in range(4):
        t = q * math.pi / 2; cx, cy = c + math.cos(t) * R * 0.86, c + math.sin(t) * R * 0.86; s = R * 0.07
        d.polygon([(cx + math.cos(t) * s, cy + math.sin(t) * s), (cx + math.cos(t + 2.2) * s, cy + math.sin(t + 2.2) * s), (cx + math.cos(t - 2.2) * s, cy + math.sin(t - 2.2) * s)], fill=255)
    return finish(over(a, emboss(g, n)), size)

def knob(size=200):
    n = size * SS; R = n / 2 - 6 * SS; yy = np.mgrid[0:n, 0:n][0]
    a = np.zeros((n, n, 4), np.float32)
    sh = Image.fromarray((cmask(n, R) * 140).astype(np.uint8)).filter(ImageFilter.GaussianBlur(6 * SS))
    a = over(a, layer((0, 0, 0, 255), np.asarray(sh) / 255.0))
    a = over(a, layer((0, 0, 0, 220), cmask(n, R * 0.97)))
    ball = chrome(n); ball[..., 3] = 200
    a = over(a, layer(ball, cmask(n, R * 0.93)))
    a = over(a, layer((255, 255, 255, 120), cmask(n, R * 0.6, cy=n / 2 - R * 0.3) * np.clip((n / 2 - yy) / R, 0, 1)))
    return finish(a, size)

def skill_frame(icon=None, size=256):
    n = size * SS; R = n / 2 - 6 * SS; yy = np.mgrid[0:n, 0:n][0]
    a = disc(size, glass=0.22 if icon is None else 0.5, orn=icon is None)
    if icon is not None:
        ri = R * 0.90; k = int(2 * ri)
        ic = icon.convert('RGBA').resize((k, k), Image.LANCZOS)
        m = Image.fromarray((cmask(k, ri - SS) * 255).astype(np.uint8))
        tmp = Image.new('RGBA', (n, n), (0, 0, 0, 0)); tmp.paste(ic, (int(n / 2 - ri),) * 2, m)
        a = over(a, np.asarray(tmp, np.float32))
        w = R * 0.085
        a = over(a, layer((0, 0, 0, 230), cmask(n, R + 1.5 * SS, R - w - 1.5 * SS)))
        a = over(a, layer(chrome(n), cmask(n, R, R - w)))
        a = over(a, layer((255, 255, 255, 60), cmask(n, R - w, cy=n / 2 - R * 0.25) * cmask(n, R - w) * np.clip((n / 2 - yy) / R, 0, 1)))
    return finish(a, size)

if __name__ == '__main__':
    os.makedirs(OUT, exist_ok=True)
    button('sword', 384, glass=0.32).save(OUT + '/atk.png')
    for k in ('chat', 'grid', 'lock', 'pk', 'auto', 'fist', 'bike'): button(k).save(OUT + '/%s.png' % k)
    button('pick_b').save(OUT + '/pickup.png')
    button('fist', lit=True).save(OUT + '/fist_on.png')
    button('pk', lit=True).save(OUT + '/pk_on.png'); button('auto', lit=True).save(OUT + '/auto_on.png')
    for i in range(1, 5):
        text_button('F%d' % i).save(OUT + '/f%d.png' % i); text_button('F%d' % i, lit=True).save(OUT + '/f%d_on.png' % i)
    joystick().save(OUT + '/stick_base.png'); knob().save(OUT + '/stick_knob.png'); skill_frame().save(OUT + '/slot_empty.png')
    print('ok')

def rmask(n, x0, y0, x1, y1, rad):
    im = Image.new('L', (n, n), 0); ImageDraw.Draw(im).rounded_rectangle((x0, y0, x1, y1), rad, fill=255)
    return np.asarray(im, np.float32) / 255.0

def potion_slot(icon=None, count=None, size=160):
    """square quick slot: dark glass, chrome bevel frame like the GUI's buttons"""
    n = size * SS; m0 = 8 * SS; rad = 14 * SS; w = 9 * SS
    a = np.zeros((n, n, 4), np.float32)
    sh = Image.fromarray((rmask(n, m0, m0, n - m0, n - m0, rad) * 110).astype(np.uint8)).filter(ImageFilter.GaussianBlur(5 * SS))
    a = over(a, layer((0, 0, 0, 255), np.asarray(sh) / 255.0))
    outer = rmask(n, m0, m0, n - m0, n - m0, rad)
    inner = rmask(n, m0 + w, m0 + w, n - m0 - w, n - m0 - w, rad - w)
    a = over(a, layer((0, 0, 0, 230), rmask(n, m0 - 1.5 * SS, m0 - 1.5 * SS, n - m0 + 1.5 * SS, n - m0 + 1.5 * SS, rad + 2 * SS) * (1 - inner)))
    a = over(a, layer(chrome(n), outer * (1 - inner)))
    a = over(a, layer((0, 0, 0, 230), inner * (1 - rmask(n, m0 + w + 1.5 * SS, m0 + w + 1.5 * SS, n - m0 - w - 1.5 * SS, n - m0 - w - 1.5 * SS, rad - w))))
    body = radial(n, [(0, (34, 35, 32, 70)), (0.9, (24, 24, 22, 110)), (1.4, (10, 10, 10, 150))])
    ii = rmask(n, m0 + w + 1.5 * SS, m0 + w + 1.5 * SS, n - m0 - w - 1.5 * SS, n - m0 - w - 1.5 * SS, rad - w)
    a = over(a, layer(body, ii))
    if icon is not None:
        k = int(n - 2 * (m0 + w + 5 * SS))
        ic = icon.convert('RGBA').resize((k, k), Image.LANCZOS)
        tmp = Image.new('RGBA', (n, n), (0, 0, 0, 0)); tmp.paste(ic, ((n - k) // 2, (n - k) // 2))
        a = over(a, np.asarray(tmp, np.float32))
    yy = np.mgrid[0:n, 0:n][0]
    a = over(a, layer((255, 255, 255, 40), ii * np.clip((n * 0.45 - yy) / (n * 0.4), 0, 1)))
    if count is not None:
        g = Image.new('L', (n, n), 0); d = ImageDraw.Draw(g)
        f = ImageFont.truetype('tahomabd.ttf', int(n * 0.24)); t = str(count)
        b = d.textbbox((0, 0), t, font=f)
        d.text((n - m0 - w - 6 * SS - (b[2] - b[0]) - b[0], n - m0 - w - 4 * SS - (b[3] - b[1]) - b[1]), t, font=f, fill=255)
        a = over(a, emboss(g, n))
    return finish(a, size)
