"""Mac app icon: the blue pillow without its black tile, smaller, on a clear
background with a soft shadow (Apple's icon grid: art inside ~80% of the
canvas). Windows keeps the full-tile icon.

Run on a Mac (needs Pillow, NumPy, SciPy and iconutil):
  python make-mac-icon.py <1024px source png> <out dir>
Writes <out dir>/icon-mac.png and <out dir>/icon-mac.icns.
"""
import os
import subprocess
import sys

import numpy as np
from PIL import Image, ImageFilter
from scipy import ndimage

SRC, OUT = sys.argv[1], sys.argv[2]
N = 1024
ART = 0.80          # largest side of the pillow, as a share of the canvas
SHADOW_BLUR = 22    # px at 1024
SHADOW_DY = 14
SHADOW_ALPHA = 0.45

im = Image.open(SRC).convert("RGBA").resize((N, N), Image.LANCZOS)
a = np.asarray(im).astype(np.float32)
r, g, b = a[..., 0], a[..., 1], a[..., 2]

# The pillow is blue; the tile is near-black and neutral. Seed on clearly blue
# pixels, take the largest piece, fill its holes (dark reflections inside).
blue = (b > 45) & (b > r + 20) & (b > g + 10)
lab, n = ndimage.label(blue)
sizes = ndimage.sum(blue, lab, range(1, n + 1))
body = lab == (1 + int(np.argmax(sizes)))
# Dark creases reach the rim in places: close with a round brush wider than them.
yy, xx = np.mgrid[-24:25, -24:25]
body = np.pad(body, 30)
body = ndimage.binary_closing(body, structure=(xx * xx + yy * yy) <= 24 * 24)[30:-30, 30:-30]
body = ndimage.binary_fill_holes(body)
body = ndimage.binary_erosion(body, iterations=1)

# Soft 1.5 px edge so the cut-out is not jagged.
alpha = ndimage.gaussian_filter(body.astype(np.float32), 1.2)
alpha = np.clip((alpha - 0.5) * 2.2 + 0.5, 0, 1)

art = a.copy()
art[..., 3] = alpha * 255
art_im = Image.fromarray(art.astype(np.uint8), "RGBA")

# Crop to the pillow, scale to ART of the canvas, centre.
ys, xs = np.nonzero(alpha > 0.02)
art_im = art_im.crop((xs.min(), ys.min(), xs.max() + 1, ys.max() + 1))
s = ART * N / max(art_im.size)
art_im = art_im.resize((round(art_im.width * s), round(art_im.height * s)), Image.LANCZOS)
ox, oy = (N - art_im.width) // 2, (N - art_im.height) // 2

canvas = Image.new("RGBA", (N, N), (0, 0, 0, 0))
shadow_a = Image.new("L", (N, N), 0)
shadow_a.paste(art_im.getchannel("A"), (ox, oy + SHADOW_DY))
shadow_a = shadow_a.filter(ImageFilter.GaussianBlur(SHADOW_BLUR)).point(lambda v: int(v * SHADOW_ALPHA))
canvas.paste(Image.new("RGBA", (N, N), (0, 0, 0, 255)), (0, 0), shadow_a)
canvas.alpha_composite(art_im, (ox, oy))

os.makedirs(OUT, exist_ok=True)
canvas.save(os.path.join(OUT, "icon-mac.png"))

iconset = os.path.join(OUT, "icon-mac.iconset")
os.makedirs(iconset, exist_ok=True)
for px in (16, 32, 128, 256, 512):
    canvas.resize((px, px), Image.LANCZOS).save(os.path.join(iconset, f"icon_{px}x{px}.png"))
    canvas.resize((px * 2, px * 2), Image.LANCZOS).save(os.path.join(iconset, f"icon_{px}x{px}@2x.png"))
subprocess.run(["iconutil", "-c", "icns", iconset, "-o", os.path.join(OUT, "icon-mac.icns")], check=True)
for name, bg in (("light", (236, 236, 236)), ("dark", (40, 40, 44))):
    prev = Image.new("RGBA", (N, N), bg + (255,))
    prev.alpha_composite(canvas)
    prev.convert("RGB").resize((256, 256), Image.LANCZOS).save(os.path.join(OUT, f"preview-{name}.png"))
print("wrote", os.path.join(OUT, "icon-mac.png"), "and icon-mac.icns")
