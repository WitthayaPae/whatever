import os, sys
from PIL import Image, ImageDraw, ImageFont
D = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, D)
import art
A = D + '/art/'
base = Image.open(D + '/hud_off.png').convert('RGBA')
now = Image.open(D + '/hud_now.png').convert('RGBA')
k = 1.92
def P(x, y): return (int(x * k), int(y * k))
out = base.copy()
def put(name_or_im, c, d):
    im = Image.open(A + name_or_im) if isinstance(name_or_im, str) else name_or_im
    im = im.resize((d, d), Image.LANCZOS)
    out.alpha_composite(im, (c[0] - d // 2, c[1] - d // 2))

# joystick + knob
j = P(212, 865); put('stick_base.png', j, 420); put('stick_knob.png', j, 160)
# attack
put('atk.png', P(1770, 862), 320)
# skills: 1 and 2 carry the real skill art, cut from the live frame
slots = {1: (1522, 903), 2: (1540, 810), 3: (1610, 745), 4: (1690, 690), 5: (1772, 660), 6: (1418, 830),
         7: (1455, 722), 8: (1513, 648), 9: (1592, 590), 0: (1681, 552)}
for n, (sx, sy) in slots.items():
    c = P(sx, sy)
    if n in (1, 2):
        icon = now.crop((c[0] - 52, c[1] - 52, c[0] + 52, c[1] + 52))
        put(art.skill_frame(icon), c, 168)
    else:
        put('slot_empty.png', c, 168)
# F1-F4 (F1 lit)
for i, fx in enumerate((1425, 1490, 1555, 1620)):
    put('f%d%s.png' % (i + 1, '_on' if i == 0 else ''), P(fx, 980), 100)
put('chat.png', P(1770, 410), 236)
for yy, kd in zip((330, 463, 575, 685), ('grid', 'lock', 'pk', 'auto')): put(kd + '.png', P(1932, yy), 128)
put('fist.png', P(522, 1065), 128); put('bike.png', P(602, 1065), 128); put('pickup.png', P(1770, 995), 112)
# classic Q + party (original PC art, 4x Real-ESRGAN)
im4 = Image.open(D + '/interface_main_x4.png').convert('RGBA')
qa = Image.open(D + '/q_icon_x4.png').convert('RGBA').crop((0, 0, 128, 128)).resize((84, 84), Image.LANCZOS)
out.alpha_composite(qa, (P(1662, 95)[0] - 42, P(1662, 95)[1] - 42))
party = im4.crop((1714, 892, 1846, 1022)).resize((84, 84), Image.LANCZOS)
out.alpha_composite(party, (P(1742, 95)[0] - 42, P(1742, 95)[1] - 42))
# potion row: the six quick slots under the HP bars (two filled, as in play)
sup = Image.open(r'C:/Users/tapnu/Downloads/RAN/DEV EP9/CLIENT/textures/gui_hd/supplies_set.png').convert('RGBA')
cell = lambda cx, cy: sup.crop((cx * 70, cy * 70, cx * 70 + 70, cy * 70 + 70))
fill = {0: (cell(6, 0), 48), 1: (cell(3, 0), 25), 2: (cell(4, 1), 9)}
for i in range(6):
    c = (660 + 88 + 120 * i, 30 + 85)
    ic, cnt = fill.get(i, (None, None))
    put(art.potion_slot(ic, cnt), c, 116)
out.convert('RGB').save(D + '/proposed2_full.png')

# sheet: now vs proposed, plus close-ups and the menu icons
half = lambda im: im.convert('RGB').resize((1920, 1080), Image.LANCZOS)
sheet = Image.new('RGB', (1920 * 2 + 30, 1080 + 80 + 1000), (22, 24, 28)); sd = ImageDraw.Draw(sheet)
FT = ImageFont.truetype('tahoma.ttf', 46)
sheet.paste(half(now), (0, 80)); sheet.paste(half(out), (1950, 80))
sd.text((20, 15), 'ตอนนี้', font=FT, fill=(240, 220, 170))
sd.text((1970, 15), 'เสนอ: ปุ่มโปร่งแสงแบบ RoV ขอบเงินโครเมียมแบบปุ่ม GUI ในเกม', font=FT, fill=(240, 220, 170))
# 1:1 close-up of the proposed right side
crop = out.crop((2560, 900, 3840, 2160)).convert('RGB').resize((960, 945), Image.LANCZOS)
sheet.paste(crop, (20, 1200)); sd.text((20, 1170 - 10), 'ขยาย: ฝั่งขวา (สกิล/โจมตี)', font=FT, fill=(200, 200, 200))
cropl = out.crop((0, 0, 1500, 260)).convert('RGB').resize((960, 166), Image.LANCZOS); sheet.paste(cropl, (1000, 1730)); cropl = out.crop((0, 1200, 1300, 2160)).convert('RGB').resize((960, 709), Image.LANCZOS)
sheet.paste(cropl, (1000, 1200)); sd.text((1000, 1160), 'ขยาย: จอยสติ๊ก', font=FT, fill=(200, 200, 200))
sd.text((1990, 1160), 'ไอคอนเมนู: ตอนนี้ (วาดใหม่)', font=FT, fill=(240, 220, 170))
mi = Image.open(D + '/mobile_icons.png').convert('RGBA')
for i in range(6):
    c = mi.crop((i * 128, 0, i * 128 + 128, 128)).resize((150, 150), Image.LANCZOS); sheet.paste(c, (1990 + i * 175, 1230), c)
sd.text((1990, 1420), 'ไอคอนเมนู: คลาสสิก (ภาพเดิม PC ขยายคมชัด)', font=FT, fill=(240, 220, 170))
for i in range(6):
    x0 = 17 + i * 25; c = im4.crop((x0 * 4, 278 * 4, (x0 + 24) * 4, (278 + 24) * 4)).resize((150, 150), Image.LANCZOS)
    sheet.paste(c, (1990 + i * 175, 1490))
sd.text((1990, 1700), 'ตำแหน่ง ขนาด และการทำงานเหมือนเดิมทั้งหมด', font=FT, fill=(200, 200, 200))
sd.text((1990, 1770), 'ความโปร่งแสงปรับได้ (ตอนนี้ ~30%)', font=FT, fill=(200, 200, 200))
sheet.save(D + '/hud_mockup2.png'); print('ok')
