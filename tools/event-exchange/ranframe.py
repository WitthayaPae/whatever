# The item-icon frame every shipped sheet uses (measured on commercialset03, Supplies_Set,
# CommercialSet: identical), 35 px cell:
#   px 0      black
#   px 1      bevel: light (183,176,167) on top and right, dark (100,91,86) on left and bottom
#   px 2      dark line (23,20,17)
#   px 3..31  the picture, 29 x 29
#   px 32     dark line, 33 bevel, 34 black (the mirror)
# gui_hd cells are the same at 2x (70 px, picture 58 x 58).
from PIL import Image

BLACK, LIGHT, DARK, LINE = (0, 0, 0), (183, 176, 167), (100, 91, 86), (23, 20, 17)

def _frame(scale):
    n = 35 * scale
    im = Image.new('RGB', (n, n), BLACK)
    px = im.load()
    def ring(k, top_right, left_bottom):
        a, b = k * scale, (35 - 1 - k) * scale
        for s in range(scale):
            lo, hi = a + s, b + scale - 1 - s
            for t in range(lo, hi + 1):
                px[t, lo] = top_right          # top
                px[hi, t] = top_right          # right
                px[lo, t] = left_bottom        # left
                px[t, hi] = left_bottom        # bottom
    ring(1, LIGHT, DARK)
    ring(2, LINE, LINE)
    return im

def cell(art, scale=1):
    """art: a square RGB/RGBA image of the picture alone (no frame)."""
    im = _frame(scale)
    inner = 29 * scale
    pic = art.convert('RGB').resize((inner, inner), Image.LANCZOS)
    im.paste(pic, (3 * scale, 3 * scale))
    return im
