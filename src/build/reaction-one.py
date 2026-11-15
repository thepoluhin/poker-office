# Одна реакция из отдельной картинки на белом фоне → public/reactions/<id>.png (256 px, прозрачный фон).
# Лицо подгоняется под размер и положение лиц в общем наборе (ширина 182 px, центр 127,127),
# то, что выше лица (рожки), уходит вверх — как пламя у «Огня».
#   python build/reaction-one.py reactions-source/bluff.jpg bluff
import os, sys
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.dirname(HERE)
path, rid = sys.argv[1], sys.argv[2]
SIZE, FACE, CENTER = 256, 182, 127

img = Image.open(os.path.join(SRC, path) if not os.path.isabs(path) else path).convert('RGB')
W, H = img.size
rgb = np.asarray(img).astype(np.float32)
minc = rgb.min(axis=2)

# фон — почти белое, связанное с краем (так же, как в reactions.py)
white = (minc >= 236).astype(np.uint8) * 255
pad = Image.new('L', (W + 2, H + 2), 255)
pad.paste(Image.fromarray(white, 'L'), (1, 1))
ImageDraw.floodfill(pad, (0, 0), 128)
fg = ~(np.asarray(pad)[1:-1, 1:-1] == 128)
fg_img = Image.fromarray((fg * 255).astype(np.uint8), 'L')
grow = np.asarray(fg_img.filter(ImageFilter.MaxFilter(7))) > 0
shrink = np.asarray(fg_img.filter(ImageFilter.MinFilter(7))) > 0
band = grow & ~shrink
ref = np.asarray(Image.fromarray(minc.astype(np.uint8), 'L').filter(ImageFilter.MinFilter(9))).astype(np.float32)
alpha = np.where(fg, 1.0, 0.0)
est = np.clip((255 - minc) / np.maximum(255 - ref, 30), 0, 1)
alpha = np.where(band, est, alpha)
alpha = np.where(shrink, 1.0, alpha)
a3 = alpha[..., None]
col = np.clip(np.where(a3 > 0.02, (rgb - (1 - a3) * 255) / np.maximum(a3, 0.02), 0), 0, 255)
rgba = Image.fromarray(np.dstack([col, alpha * 255]).astype(np.uint8), 'RGBA')

# лицо — круг: его ширина — самая широкая строка маски, низ рамки — низ лица (рожки и пламя сверху не мешают)
m = alpha > 0.5
ys, xs = np.where(m)
y1 = ys.max()
rows = [(r, np.where(m[r])[0]) for r in range(ys.min(), y1 + 1)]
r, xr = max((p for p in rows if len(p[1])), key=lambda p: p[1].max() - p[1].min())
x0, x1 = xr.min(), xr.max()
face_w = x1 - x0
fcx, fcy = (x0 + x1) / 2, y1 - face_w / 2
k = FACE / face_w
big = rgba.resize((round(W * k), round(H * k)), Image.LANCZOS)
canvas = Image.new('RGBA', (SIZE, SIZE), (0, 0, 0, 0))
canvas.alpha_composite(big, (round(CENTER - fcx * k), round(CENTER - fcy * k)))
canvas.save(os.path.join(SRC, 'public', 'reactions', rid + '.png'), optimize=True)
top = np.where(np.asarray(canvas)[..., 3] > 128)[0].min()
print(rid, 'face', face_w, 'scale', round(k, 4), 'top', top)
