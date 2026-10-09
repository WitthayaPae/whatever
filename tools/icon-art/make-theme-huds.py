"""The HUD in the three window styles (2026-10-09, user: "the HUD as well, switch 3 of them").

    python make-theme-huds.py

hud_silver.png (make-silver-hud.py) is the Tactical set as it is. Crystal and
Royal are graded from it: each pixel moves toward the theme's tint in
proportion to its brightness, so the chrome rims, studs and glyphs take the
colour while the dark glass bodies stay neutral and see-through.
Writes hud_crystal.png and hud_royal.png; then
    node topdds.js ../../../CLIENT/textures/gui/mobile_hud4.dds hud_crystal.png
    node topdds.js ../../../CLIENT/textures/gui/mobile_hud5.dds hud_royal.png
"""
import os
import numpy as np
from PIL import Image
HERE = os.path.dirname(os.path.abspath(__file__))
src = np.asarray(Image.open(os.path.join(HERE, 'hud_silver.png')).convert('RGBA'), np.float32)
TINT = {
    'crystal': (0.80, 0.93, 1.14),   # icy glass, A
    'royal':   (1.10, 0.86, 0.50),   # gold, B
}
for name, t in TINT.items():
    out = src.copy()
    L = (0.299 * src[..., 0] + 0.587 * src[..., 1] + 0.114 * src[..., 2]) / 255.0
    k = np.clip((L - 0.15) / 0.85, 0, 1)[..., None]       # dark glass left alone
    tint = np.array(t, np.float32)[None, None, :]
    out[..., :3] = src[..., :3] * (1.0 + (tint - 1.0) * k)
    Image.fromarray(np.clip(out, 0, 255).astype(np.uint8), 'RGBA').save(os.path.join(HERE, 'hud_%s.png' % name))
    print(name, 'ok')
