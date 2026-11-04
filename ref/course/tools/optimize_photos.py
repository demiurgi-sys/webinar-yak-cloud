#!/usr/bin/env python3
"""Фото групи «Грандіозні» (640/960 px, q75, з grandiozni.jpg) і фото Олени (600 px, q80, з olena.webp).

  py -3 tools/optimize_photos.py

grandiozni.webp (1280 px) лишається як найбільший розмір srcset, grandiozni.jpg – fallback.
Якщо підмінюєте grandiozni.jpg/.webp новою обкладинкою – запустіть скрипт знову, потім
py -3 tools/build_index.py (оновить ?v= у index.html), інакше відвідувачі з кешем бачитимуть стару.
"""
from pathlib import Path

from PIL import Image

IMG = Path(__file__).resolve().parent.parent / 'assets' / 'images'


def save_width(src: Path, width: int, dst: Path, quality: int):
    with Image.open(src) as im:
        im = im.convert('RGB')
        h = round(im.height * width / im.width)
        im.resize((width, h), Image.Resampling.LANCZOS).save(dst, 'WEBP', quality=quality, method=6)
    print(f'{dst.name}: {dst.stat().st_size / 1024:.0f} КБ')


for w in (640, 960):
    save_width(IMG / 'grandiozni.jpg', w, IMG / f'grandiozni-{w}.webp', 75)
save_width(IMG / 'olena.webp', 600, IMG / 'olena-600.webp', 80)
