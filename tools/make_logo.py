"""Cut the FLUX 3D logo out of its white background (keeping a soft shadow) and export every icon size."""
import os, sys
import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageEnhance

SRC = sys.argv[1]
OUT = os.path.join(os.path.dirname(__file__), '..', 'src', 'assets', 'img')
STATIC = os.path.join(os.path.dirname(__file__), '..', 'src', 'static')
os.makedirs(OUT, exist_ok=True); os.makedirs(STATIC, exist_ok=True)

im = Image.open(SRC).convert('RGB')
W, H = im.size
# Background = near-white region connected to the image border.
mask = im.copy()
for xy in [(0, 0), (W - 1, 0), (0, H - 1), (W - 1, H - 1)]:
    ImageDraw.floodfill(mask, xy, (255, 0, 255), thresh=18)
rich = ImageEnhance.Contrast(ImageEnhance.Color(im).enhance(1.55)).enhance(1.06)
arr = np.asarray(rich).astype(np.float32)
lum = np.asarray(im).astype(np.float32).mean(axis=-1)
bg = np.all(np.asarray(mask) == [255, 0, 255], axis=-1)
# Soft shadow: keep how much darker than white the background pixels are.
shadow = np.clip((250 - lum) / 250 * 255 * 2.4, 0, 120)
alpha = np.where(bg, shadow, 255).astype(np.uint8)
alpha_img = Image.fromarray(alpha).filter(ImageFilter.GaussianBlur(0.6))
rgba = np.dstack([arr.astype(np.uint8), np.asarray(alpha_img)])
# Background pixels become a dark green tint so the shadow looks natural on any colour.
rgb = rgba[..., :3]
rgb[bg] = [6, 78, 59]
out = Image.fromarray(rgba)
bbox = Image.fromarray((alpha > 8).astype(np.uint8) * 255).getbbox()
x0, y0, x1, y1 = bbox
size = max(x1 - x0, y1 - y0) + 24
cx, cy = (x0 + x1) // 2, (y0 + y1) // 2
crop = out.crop((cx - size // 2, cy - size // 2, cx + size // 2, cy + size // 2))
crop.save(os.path.join(OUT, 'logo-master.png'))
for s in (96, 192, 512):
    crop.resize((s, s), Image.LANCZOS).save(os.path.join(OUT, f'logo-{s}.png'), optimize=True)
crop.resize((192, 192), Image.LANCZOS).save(os.path.join(OUT, 'logo-192.webp'), quality=90)
crop.resize((96, 96), Image.LANCZOS).save(os.path.join(OUT, 'logo-96.webp'), quality=92)
# Apple/Android need an opaque square.
bgc = Image.new('RGBA', (180, 180), (242, 250, 245, 255))
icon = crop.resize((168, 168), Image.LANCZOS)
bgc.alpha_composite(icon, (6, 8))
bgc.convert('RGB').save(os.path.join(STATIC, 'apple-touch-icon.png'), optimize=True)
crop.resize((32, 32), Image.LANCZOS).save(os.path.join(STATIC, 'favicon-32.png'), optimize=True)
crop.resize((48, 48), Image.LANCZOS).save(os.path.join(STATIC, 'favicon.ico'), sizes=[(16, 16), (32, 32), (48, 48)])
print('logo ok', crop.size)
