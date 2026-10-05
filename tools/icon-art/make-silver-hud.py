"""Build the silver HUD (2026-10-05, approved from MOBILE/design/hud_mockup6.png).

    python make-silver-hud.py <RealESRGAN_x4plus.pth>

Writes, next to this file:
  hud_silver.png      the on-screen controls, cell order = hud-pack.js CELLS
                      plus cell 26 (the skill-slot ring); 1280x1536
  icons_classic.png   mobile_icons.dds's cells, the original PC art for each
                      menu control upscaled 4x (Real-ESRGAN) - same layout, so
                      no XML changes; 1024x512
Then: node topdds.js <dest.dds> <png> for each.
"""
import os, sys
import numpy as np
from PIL import Image
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import silver_art as A
ROOT = os.path.abspath(os.path.join(HERE, '..', '..', '..'))
GUI = os.path.join(ROOT, 'CLIENT', 'textures', 'gui')

def hud():
    N = 256
    clear = Image.new('RGBA', (N, N), (0, 0, 0, 0))
    cells = [
        A.button('sword', N),            clear,                         A.potion_slot(None, None, N),
        A.button('auto', N),             A.button('auto', N, lit=True),
        A.button('pk', N),               A.button('pk', N, lit=True),
        A.button('lock', N),             A.button('lock', N, lit=True),  A.button('pick_b', N),
        A.button('bike', N),             A.button('grid', N),
        A.text_button('F1', N), A.text_button('F2', N), A.text_button('F3', N), A.text_button('F4', N),
        A.text_button('F1', N, True), A.text_button('F2', N, True), A.text_button('F3', N, True), A.text_button('F4', N, True),
        A.joystick(N),                   A.knob(N),
        A.button('chat', N),             A.fold_plate(N),
        A.button('fist', N),             A.button('fist', N, lit=True),
        A.skill_frame(None, N),          # 26: skill-slot ring
        A.button('bot', N),              # 27: auto-hunt
        A.button('bot', N, lit=True),    # 28: auto-hunt, running
    ]
    W, H = N * 5, N * 6
    sheet = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    for i, im in enumerate(cells):
        sheet.paste(im, ((i % 5) * N, (i // 5) * N))
    out = os.path.join(HERE, 'hud_silver.png'); sheet.save(out); print('hud', len(cells), 'cells ->', out)

#  mobile_icons.dds cell (x, y) -> the control's original PC art (file, x, y, w, h),
#  read from the pre-mobile GUI XML (Gui.rcc.bak_pre_itemsheet).
CLASSIC = {
    (0, 0):     ('interface_main.dds', 18, 278, 24, 24),    # inventory
    (128, 0):   ('interface_main.dds', 43, 278, 24, 24),    # character
    (256, 0):   ('interface_main.dds', 68, 278, 24, 24),    # skill
    (384, 0):   ('interface_main.dds', 93, 278, 24, 24),    # party
    (512, 0):   ('interface_main.dds', 118, 278, 24, 24),   # guild
    (640, 0):   ('interface_main.dds', 143, 278, 24, 24),   # quest (+ quest alarm)
    (768, 0):   ('interface_main.dds', 202, 339, 24, 24),   # friend
    (896, 0):   ('interface_main.dds', 477, 447, 24, 24),   # large map
    (0, 128):   ('interface_main.dds', 331, 122, 24, 24),   # chat macro
    (128, 128): ('interface_main.dds', 477, 474, 24, 24),   # item bank
    (256, 128): ('interface_main.dds', 305, 122, 24, 24),   # item shop
    (384, 128): ('q_icon.dds', 175, 35, 35, 35),            # quest-alarm / competition blink
    (512, 128): ('ingame_description.dds', 20, 14, 35, 35), # party finder
    (640, 128): ('chatting_group_aa.dds', 70, 36, 35, 35),  # ranking
    (768, 128): ('sc_battle_ui_set.dds', 206, 15, 35, 35),  # competition
    (896, 128): ('boss_spawn.dds', 0, 0, 35, 35),           # boss viewer (the shipped file is one 35x35 icon)
    (0, 256):   ('auction_icon.dds', 0, 0, 64, 64),         # auction
    (128, 256): ('chatting_group_aa.dds', 35, 36, 35, 35),  # item mall
    (256, 256): ('gui_combination.dds', 455, 0, 35, 35),    # product
    (384, 256): ('interface_main.dds', 177, 280, 41, 20),   # esc menu ("MENU")
    (512, 256): ('interface_main.dds', 257, 227, 24, 24),   # run (lit)
    (640, 256): ('interface_main.dds', 0, 252, 24, 24),     # press highlight
    (768, 256): ('q_icon.dds', 175, 35, 35, 35),            # auction alert
    (896, 256): ('q_icon.dds', 0, 0, 35, 35),               # q box
    (0, 384):   ('q_icon.dds', 140, 35, 35, 35),            # mini party
}

def gm_tile(size=128):
    """GM menu cell: a bevelled sepia tile like the classic PC icons, 'GM' on it."""
    from PIL import ImageDraw, ImageFont, ImageFilter
    S = 4; n = size * S
    im = Image.new('RGBA', (n, n), (0, 0, 0, 0)); d = ImageDraw.Draw(im)
    m = 6 * S
    d.rounded_rectangle((m, m, n - m, n - m), 10 * S, fill=(30, 22, 14, 255))
    for k in range(10 * S):
        t = k / (10 * S)
        c = (int(210 - 90 * t), int(170 - 80 * t), int(110 - 60 * t), 255)
        d.rounded_rectangle((m + k, m + k, n - m - k, n - m - k), max(1, 10 * S - k), outline=c)
    inner = Image.new('RGBA', (n, n), (0, 0, 0, 0)); di = ImageDraw.Draw(inner)
    di.rounded_rectangle((m + 10 * S, m + 10 * S, n - m - 10 * S, n - m - 10 * S), 4 * S, fill=(92, 62, 34, 255))
    im.alpha_composite(inner)
    f = ImageFont.truetype('georgiab.ttf', int(n * 0.40))
    b = d.textbbox((0, 0), 'GM', font=f)
    x = (n - (b[2] - b[0])) / 2 - b[0]; y = (n - (b[3] - b[1])) / 2 - b[1]
    sh = Image.new('L', (n, n), 0); ImageDraw.Draw(sh).text((x + 2 * S, y + 3 * S), 'GM', font=f, fill=200)
    im.paste((0, 0, 0, 255), (0, 0), sh.filter(ImageFilter.GaussianBlur(2 * S)))
    d = ImageDraw.Draw(im)
    d.text((x, y), 'GM', font=f, fill=(250, 226, 160, 255), stroke_width=2 * S, stroke_fill=(60, 36, 12, 255))
    return im.resize((size, size), Image.LANCZOS)

def classic(weights):
    import torch
    from spandrel import ModelLoader
    model = ModelLoader().load_from_file(weights).model.eval()
    cache = {}
    def up4(name):
        if name in cache: return cache[name]
        im = Image.open(os.path.join(GUI, name)); im.load(); im = im.convert('RGBA')
        x = torch.from_numpy(np.asarray(im.convert('RGB')).astype(np.float32) / 255.0).permute(2, 0, 1)[None]
        with torch.no_grad(): y = model(x)
        y = Image.fromarray((y[0].permute(1, 2, 0).clamp(0, 1).numpy() * 255 + 0.5).astype(np.uint8)).convert('RGBA')
        y.putalpha(im.getchannel('A').resize(y.size, Image.BICUBIC))
        cache[name] = y; return y
    sheet = Image.new('RGBA', (1024, 512), (0, 0, 0, 0))
    for (cx, cy), (name, x, y, w, h) in CLASSIC.items():
        big = up4(name).crop((x * 4, y * 4, (x + w) * 4, (y + h) * 4))
        s = 128 / max(w, h) / 4
        im = big.resize((max(1, round(w * 4 * s)), max(1, round(h * 4 * s))), Image.LANCZOS)
        sheet.paste(im, (cx + (128 - im.size[0]) // 2, cy + (128 - im.size[1]) // 2))
    sheet.paste(gm_tile(), (128, 384))     # GM menu (Master only), MOBILE_GM_BUTTON
    out = os.path.join(HERE, 'icons_classic.png'); sheet.save(out); print('icons', len(CLASSIC), 'cells ->', out)

if __name__ == '__main__':
    hud()
    if len(sys.argv) > 1: classic(sys.argv[1])
