#!/usr/bin/env python3
"""Слайди каруселі «Програма навчання»: N.webp (1080x1920, оригінал) -> N-360-v2 / N-720-v2 / N-1080-v2 .webp.

  py -3 tools/optimize_slides.py            # усі 21 слайд, якість 72
  py -3 tools/optimize_slides.py 5 12       # лише слайди 5 і 12
  py -3 tools/optimize_slides.py --quality 75

Імена з суфіксом -v2 нові: старі N-360/720/1080.webp лишаються, посилання в index.html
перемикаються на -v2, тож кеш браузерів не плутає старі й нові файли.
"""
import sys
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
IMG = ROOT / 'assets' / 'images'
WIDTHS = (360, 720, 1080)
SUFFIX = '-v2'


def main(argv):
    quality = 72
    args = list(argv)
    if '--quality' in args:
        i = args.index('--quality')
        quality = int(args[i + 1])
        del args[i:i + 2]
    nums = [int(a) for a in args] or range(1, 22)
    total = 0
    for n in nums:
        src = IMG / f'{n}.webp'
        with Image.open(src) as im:
            im = im.convert('RGB')
            for w in WIDTHS:
                h = round(im.height * w / im.width)
                out = im if w == im.width else im.resize((w, h), Image.Resampling.LANCZOS)
                dst = IMG / f'{n}-{w}{SUFFIX}.webp'
                out.save(dst, 'WEBP', quality=quality, method=6)
                total += dst.stat().st_size
        print(f'{n}: ok')
    print(f'разом {total / 1024:.0f} КБ, якість {quality}')


if __name__ == '__main__':
    main(sys.argv[1:])
