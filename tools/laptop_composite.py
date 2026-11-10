"""Place a real WaBridge screenshot onto the blank laptop screen of the generated photo."""
import sys
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

photo_path, shot_path, out_path = sys.argv[1:4]
quad = [tuple(map(float, p.split(','))) for p in sys.argv[4:8]]  # tl tr br bl in photo pixels

def coeffs(src, dst):
    # Perspective coefficients mapping dst (output) points -> src (input) points.
    A, B = [], []
    for (x, y), (u, v) in zip(dst, src):
        A.append([x, y, 1, 0, 0, 0, -u * x, -u * y]); B.append(u)
        A.append([0, 0, 0, x, y, 1, -v * x, -v * y]); B.append(v)
    return np.linalg.solve(np.array(A, float), np.array(B, float)).tolist()

photo = Image.open(photo_path).convert('RGBA')
shot = Image.open(shot_path).convert('RGBA')
w, h = shot.size
c = coeffs([(0, 0), (w, 0), (w, h), (0, h)], quad)
warped = shot.transform(photo.size, Image.Transform.PERSPECTIVE, c, Image.Resampling.BICUBIC)
mask = Image.new('L', photo.size, 0)
ImageDraw.Draw(mask).polygon(quad, fill=255)
mask = mask.filter(ImageFilter.GaussianBlur(0.8))
screen = Image.composite(warped, photo, mask)
# Keep a little of the original screen glow so it sits in the scene.
glow = Image.blend(screen, photo, 0.10)
final = Image.composite(glow, photo, mask)
final.convert('RGB').save(out_path, quality=95)
print('ok', out_path)
