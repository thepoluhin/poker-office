# Нарезает лист реакций reactions-source/sheet.jpg (сетка 4×5 на белом фоне)
# на отдельные PNG с прозрачным фоном в public/reactions/<id>.png.
# Запускается вручную, когда меняется лист:  python build/reactions.py
# Нужны Pillow и numpy. Готовые PNG лежат в проекте, сборке exe этот скрипт не нужен.
import os, sys, json
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.dirname(HERE)
SHEET = os.path.join(SRC, 'reactions-source', 'sheet.jpg')
OUT = os.path.join(SRC, 'public', 'reactions')
COLS, ROWS = 4, 5
SIZE = 256
IDS = ['laugh', 'cool', 'shock', 'think',
       'angry', 'cry', 'love', 'wink',
       'sleep', 'money', 'fire', 'rofl',  # «Ржу» в игре больше нет — его место занял «Блефую» (build/reaction-one.py, reactions-source/bluff.jpg)
       'like', 'dislike', 'clap', 'pray',
       'facepalm', 'sweat', 'poker', 'eyeroll']

img = Image.open(SHEET).convert('RGB')
W, H = img.size
rgb = np.asarray(img).astype(np.float32)
minc = rgb.min(axis=2)

# фон — почти белые пиксели, связанные с краем листа (белки глаз внутри лица не трогаем)
white = (minc >= 236).astype(np.uint8) * 255
m = Image.fromarray(white, 'L')
pad = Image.new('L', (W + 2, H + 2), 255)
pad.paste(m, (1, 1))
ImageDraw.floodfill(pad, (0, 0), 128)
bg = (np.asarray(pad)[1:-1, 1:-1] == 128)
fg = ~bg

# мягкий край: в полосе у границы альфа = доля «не белого» относительно цвета внутри
fg_img = Image.fromarray((fg * 255).astype(np.uint8), 'L')
grow = np.asarray(fg_img.filter(ImageFilter.MaxFilter(7))) > 0
shrink = np.asarray(fg_img.filter(ImageFilter.MinFilter(7))) > 0
band = grow & ~shrink
ref = np.asarray(Image.fromarray(minc.astype(np.uint8), 'L').filter(ImageFilter.MinFilter(9))).astype(np.float32)
alpha = np.where(fg, 1.0, 0.0)
est = np.clip((255 - minc) / np.maximum(255 - ref, 30), 0, 1)
alpha = np.where(band, est, alpha)
alpha = np.where(shrink, 1.0, alpha)
# убрать белый ореол: цвет = (c - (1-a)*255) / a
a3 = alpha[..., None]
col = np.where(a3 > 0.02, (rgb - (1 - a3) * 255) / np.maximum(a3, 0.02), 0)
col = np.clip(col, 0, 255)

# компоненты на уменьшенной маске → к ближайшей клетке сетки
K = 4
small = fg[::K, ::K]
h, w = small.shape
lab = np.zeros((h, w), np.int32)
cells = {}
n = 0
for y in range(h):
    for x in range(w):
        if small[y, x] and not lab[y, x]:
            n += 1
            stack = [(y, x)]; lab[y, x] = n; pts = []
            while stack:
                cy, cx = stack.pop(); pts.append((cy, cx))
                for dy in (-1, 0, 1):
                    for dx in (-1, 0, 1):
                        ny, nx = cy + dy, cx + dx
                        if 0 <= ny < h and 0 <= nx < w and small[ny, nx] and not lab[ny, nx]:
                            lab[ny, nx] = n; stack.append((ny, nx))
            if len(pts) < 6:
                continue  # пылинки
            ys = [p[0] for p in pts]; xs = [p[1] for p in pts]
            gy, gx = np.mean(ys) * K, np.mean(xs) * K
            c = min(COLS - 1, int(gx / (W / COLS))); r = min(ROWS - 1, int(gy / (H / ROWS)))
            b = cells.setdefault(r * COLS + c, [W, H, 0, 0, []])
            b[0] = min(b[0], min(xs) * K); b[1] = min(b[1], min(ys) * K)
            b[2] = max(b[2], max(xs) * K + K); b[3] = max(b[3], max(ys) * K + K)
            b[4].append(n)

assert len(cells) == 20, f'нашлось клеток: {len(cells)}'
side = max(max(b[2] - b[0], b[3] - b[1]) for b in cells.values()) + 16
rgba = np.dstack([col, alpha * 255]).astype(np.uint8)
os.makedirs(OUT, exist_ok=True)
info = {}
for i, rid in enumerate(IDS):
    if rid == 'rofl':  # клетка листа осталась, а реакции в игре нет — картинку не делаем
        continue
    x0, y0, x1, y1, comps = cells[i]
    # только свои компоненты (чужие края соседей не попадут)
    own = np.isin(lab, comps)
    own = np.asarray(Image.fromarray((own * 255).astype(np.uint8), 'L').resize((W, H), Image.NEAREST).filter(ImageFilter.MaxFilter(9))) > 0
    a = rgba.copy(); a[..., 3] = np.where(own, a[..., 3], 0)
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    box = (int(cx - side / 2), int(cy - side / 2), int(cx - side / 2) + side, int(cy - side / 2) + side)
    canvas = Image.new('RGBA', (side, side), (0, 0, 0, 0))
    part = Image.fromarray(a, 'RGBA').crop((max(box[0], 0), max(box[1], 0), min(box[2], W), min(box[3], H)))
    canvas.paste(part, (max(-box[0], 0), max(-box[1], 0)))
    canvas.resize((SIZE, SIZE), Image.LANCZOS).save(os.path.join(OUT, rid + '.png'), optimize=True)
    info[rid] = [x1 - x0, y1 - y0]
print('side', side, json.dumps(info))
