# Вырезает предмет с фото в прозрачный PNG: цветок на стебле, чашку, деталь, инструмент.
# Нужен venv:  python3 -m venv /tmp/venv && /tmp/venv/bin/pip install "rembg[cpu]" scipy pillow
# Запуск:      /tmp/venv/bin/python -I cutout.py папка_с_jpg папка_для_png [--straighten 0.3]
# --straighten  выпрямить предмет: линия «центр верхней доли (головка) → низ (конец стебля)» станет вертикальной;
#               число — какая доля высоты сверху считается головкой.
# Модель birefnet-general-lite (~220 МБ, качается сама при первом запуске) держит тонкие стебли и лепестки
# заметно лучше isnet и u2net. Фото выбирайте на однотонном светлом фоне, предмет целиком в кадре.
import math, os, sys
import numpy as np
from PIL import Image
from rembg import new_session, remove
from scipy import ndimage

src, dst = sys.argv[1], sys.argv[2]
head = float(sys.argv[sys.argv.index('--straighten') + 1]) if '--straighten' in sys.argv else None
os.makedirs(dst, exist_ok=True)
session = new_session('birefnet-general-lite')

def clean(im):
    # убираем крошки и оторванные кусочки: оставляем части больше 3% от самой крупной
    a = np.array(im)
    m = a[..., 3] > 60
    lab, n = ndimage.label(m)
    if not n:
        return im
    sizes = ndimage.sum(m, lab, range(1, n + 1))
    keep = np.isin(lab, [i + 1 for i, s in enumerate(sizes) if s > sizes.max() * .03])
    a[..., 3] = np.where(ndimage.binary_dilation(keep, iterations=4), a[..., 3], 0)
    out = Image.fromarray(a)
    return out.crop(out.getbbox())

def straighten(im, frac):
    a = np.array(im)[..., 3] > 128
    h = a.shape[0]
    ys, xs = np.nonzero(a[: int(h * frac)])
    fy, fx = np.nonzero(a[int(h * .97):])
    if not len(xs) or not len(fx):
        return im
    ang = math.degrees(math.atan2(fx.mean() - xs.mean(), h - ys.mean()))
    if abs(ang) < 1:
        return im
    im = im.rotate(-ang, resample=Image.BICUBIC, expand=True)
    return im.crop(im.getbbox())

for f in sorted(os.listdir(src)):
    if not f.lower().endswith(('.jpg', '.jpeg', '.png', '.webp')):
        continue
    out = clean(remove(Image.open(os.path.join(src, f)).convert('RGB'), session=session))
    if head:
        out = straighten(out, head)
    name = os.path.splitext(f)[0]
    out.save(os.path.join(dst, name + '.png'), optimize=True)
    # для сайта: WebP с прозрачностью, в 20–40 раз легче PNG
    small = out.copy()
    small.thumbnail((1200, 640), Image.LANCZOS)
    small.save(os.path.join(dst, name + '.webp'), quality=82, method=6)
    print(f'{name}: {out.size[0]}×{out.size[1]} → {name}.png, {name}.webp')
