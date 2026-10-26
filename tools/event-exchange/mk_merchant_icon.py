# Merchant picture icon (2026-10-27): shown at the end of a trusted merchant's message line;
# a tap opens the merchant's picture (CMerchantImgWindow). Dark-gold, like the game's UI.
#   py mk_merchant_icon.py <CLIENT/textures dir>
# Writes gui/merchant_icon.dds (64 x 64, the header layout of commercialset07.dds: R,G,B,A
# bytes) and gui_hd/merchant_icon.png (128 x 128).
import sys, os, struct
from PIL import Image, ImageDraw, ImageFilter

TEX = sys.argv[1]
S = 512

def rounded(d, box, r, **kw):
    d.rounded_rectangle(box, r, **kw)

def make():
    im = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    # body: dark, warm, with a soft gold glow inside the rim
    rounded(d, (8, 8, S - 8, S - 8), 96, fill=(28, 20, 12, 255))
    glow = Image.new('L', (S, S), 0)
    ImageDraw.Draw(glow).rounded_rectangle((40, 40, S - 40, S - 40), 80, fill=150)
    glow = glow.filter(ImageFilter.GaussianBlur(40))
    im = Image.composite(Image.new('RGBA', (S, S), (120, 82, 30, 255)), im, glow)
    d = ImageDraw.Draw(im)
    # gold rim: dark outer line, bright band, dark inner line
    rounded(d, (8, 8, S - 8, S - 8), 96, outline=(60, 38, 10, 255), width=14)
    rounded(d, (22, 22, S - 22, S - 22), 84, outline=(232, 186, 82, 255), width=22)
    rounded(d, (44, 44, S - 44, S - 44), 64, outline=(90, 60, 18, 255), width=8)
    # the picture: a gold frame with sky, sun and two mountains
    fx0, fy0, fx1, fy1 = 78, 104, 434, 408
    d.rectangle((fx0, fy0, fx1, fy1), fill=(250, 214, 120, 255))
    d.rectangle((fx0 + 22, fy0 + 22, fx1 - 22, fy1 - 22), fill=(70, 120, 170, 255))
    ix0, iy0, ix1, iy1 = fx0 + 22, fy0 + 22, fx1 - 22, fy1 - 22
    d.ellipse((ix1 - 120, iy0 + 26, ix1 - 52, iy0 + 94), fill=(255, 236, 160, 255))
    d.polygon([(ix0, iy1), (ix0 + 112, iy0 + 92), (ix0 + 214, iy1)], fill=(60, 140, 80, 255))
    d.polygon([(ix0 + 140, iy1), (ix0 + 236, iy0 + 132), (ix1, iy1 - 40), (ix1, iy1)], fill=(40, 105, 62, 255))
    d.rectangle((fx0, fy0, fx1, fy1), outline=(120, 80, 20, 255), width=8)
    # a little shine top-left
    shine = Image.new('L', (S, S), 0)
    ImageDraw.Draw(shine).ellipse((60, 40, 300, 160), fill=70)
    shine = shine.filter(ImageFilter.GaussianBlur(30))
    im = Image.composite(Image.new('RGBA', (S, S), (255, 245, 210, 255)), im, shine)
    # keep the rounded outline transparent outside
    mask = Image.new('L', (S, S), 0)
    ImageDraw.Draw(mask).rounded_rectangle((8, 8, S - 8, S - 8), 96, fill=255)
    im.putalpha(mask)
    return im

def write_dds(path, img):
    w, h = img.size
    ref = open(os.path.join(TEX, 'gui', 'commercialset07.dds'), 'rb').read()[:128]
    hdr = bytearray(ref)
    struct.pack_into('<I', hdr, 12, h)		# height
    struct.pack_into('<I', hdr, 16, w)		# width
    struct.pack_into('<I', hdr, 20, w * 4)	# pitch
    open(path, 'wb').write(bytes(hdr) + img.tobytes('raw', 'RGBA'))
    chk = Image.open(path).convert('RGBA')
    assert chk.size == (w, h) and chk.getpixel((w // 2, h // 2)) == img.getpixel((w // 2, h // 2)), 'dds read back'

big = make()
sd = big.resize((64, 64), Image.LANCZOS)
hd = big.resize((128, 128), Image.LANCZOS)
write_dds(os.path.join(TEX, 'gui', 'merchant_icon.dds'), sd)
hd.save(os.path.join(TEX, 'gui_hd', 'merchant_icon.png'))
if len(sys.argv) > 2:
    prev = Image.new('RGBA', (64 + 128 + 30 + 48, 140), (40, 40, 40, 255))
    prev.alpha_composite(sd, (5, 5)); prev.alpha_composite(hd, (80, 5))
    prev.alpha_composite(big.resize((24, 24), Image.LANCZOS), (220, 5))
    prev.convert('RGB').resize((prev.width * 3, prev.height * 3), Image.NEAREST).save(sys.argv[2])
print('ok')
