"""The 1024x1024 App Store / TestFlight icon (2026-10-08).

The master art is 512 px (android/res/drawable-nodpi/ran_mark.png). App Store
Connect needs 1024 px in the asset catalog. Real-ESRGAN x4plus upscales it 4x,
Lanczos brings it to 1024 (as make-icon-hd.py does for the item icons), then it
is flattened onto black and alpha dropped, the same as make-ios-icons.js does
for the small sizes: Apple rejects an icon with an alpha channel.

    python make-appicon-1024.py RealESRGAN_x4plus.pth
writes MOBILE/native/platform/ios/Assets.xcassets/AppIcon.appiconset/AppIcon-1024.png
"""
import os, sys
import numpy as np
import torch
from PIL import Image
from spandrel import ModelLoader

HERE = os.path.dirname(os.path.abspath(__file__))
MOB = os.path.abspath(os.path.join(HERE, '..', '..'))
SRC = os.path.join(MOB, 'native', 'android', 'res', 'drawable-nodpi', 'ran_mark.png')
DST = os.path.join(MOB, 'native', 'platform', 'ios', 'Assets.xcassets', 'AppIcon.appiconset', 'AppIcon-1024.png')

model = ModelLoader().load_from_file(sys.argv[1]).model.eval()
src = Image.open(SRC).convert('RGBA')
rgb = np.asarray(src.convert('RGB'), dtype=np.float32) / 255.0
with torch.no_grad():
    t = torch.from_numpy(rgb).permute(2, 0, 1).unsqueeze(0)
    up = model(t).clamp(0, 1)[0].permute(1, 2, 0).numpy()
big = Image.fromarray((up * 255 + 0.5).astype(np.uint8), 'RGB').resize((1024, 1024), Image.LANCZOS)
alpha = src.getchannel('A').resize((1024, 1024), Image.BICUBIC)
out = Image.new('RGB', (1024, 1024), (0, 0, 0))
out.paste(big, (0, 0), alpha)
out.save(DST)
print('wrote', DST, out.size, out.mode)
