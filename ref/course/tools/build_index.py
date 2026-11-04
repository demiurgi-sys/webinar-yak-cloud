#!/usr/bin/env python3
"""Збирає сторінки сайту: inline-CSS index.html із джерел і версії ?v=<хеш> у посиланнях на assets/.

  py -3 tools/build_index.py          # переписати index.html (+ ?v= у offer/privacy/refund)
  py -3 tools/build_index.py --check  # лише перевірити, що файли відповідають джерелам (exit 1, якщо ні)

1) Inline-CSS: <style id="critical-css"> = fonts.css + styles.min.css + footer.min.css + teacher-stats.css
   (у цьому порядку; teacher-stats і fonts мінімізуються). Правте assets/css/*.css і запускайте скрипт;
   руками inline-блок не правити.
2) Версії: кожне відносне посилання assets/<файл>.<css|js|webp|jpg|png|svg|woff2> (src, srcset, href,
   url() у inline-CSS) отримує ?v=<8 hex sha1 вмісту файлу>. nginx кешує /assets/ на 30 днів, тож
   змінений файл під тим самим іменем без нового ?v= відвідувачі з кешем не побачать – завжди
   запускайте скрипт після заміни будь-якого файлу в assets/. Абсолютні URL сайту (og:image) теж
   отримують ?v=; URL інших сайтів не чіпаються.
"""
import hashlib
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CSS = ROOT / 'assets' / 'css'
PAGES = ['index.html', 'offer.html', 'privacy.html', 'refund.html']
SOURCES = [('fonts.css', True), ('styles.min.css', False), ('footer.min.css', False), ('teacher-stats.css', True)]

TOKEN = re.compile(r'("(?:[^"\\]|\\.)*"|\'(?:[^\'\\]|\\.)*\'|/\*.*?\*/)', re.S)
BLOCK = re.compile(r'(<style id="critical-css">)(.*?)(</style>)', re.S)
SITE = 'https://course.school-design.space/'
ASSET = re.compile(r'(?:(?<=' + re.escape(SITE) + r')|(?<![\w/.]))(assets/[A-Za-z0-9_./-]+\.(?:css|js|webp|jpg|jpeg|png|svg|woff2|gif|ico))(\?v=[0-9a-f]{8})?')


def minify(css: str) -> str:
    """Прибрати коментарі й зайві пробіли; рядки в лапках не чіпає."""
    out = []
    for tok in TOKEN.split(css):
        if tok.startswith('/*'):
            continue
        if len(tok) > 1 and tok[0] in '"\'' and tok[-1] == tok[0]:
            out.append(tok)
            continue
        tok = re.sub(r'\s+', ' ', tok)
        tok = re.sub(r' ?([{};,]) ?', r'\1', tok)
        tok = re.sub(r':\s+', ':', tok)
        out.append(tok)
    return ''.join(out).strip()


def build_css() -> str:
    parts = []
    for name, need_min in SOURCES:
        text = (CSS / name).read_text(encoding='utf-8-sig')
        parts.append(minify(text) if need_min else text.strip())
    css = ''.join(parts)
    assert '</style' not in css.lower()
    return css


def file_hash(rel: str) -> str:
    p = ROOT / rel
    if not p.is_file():
        raise SystemExit('посилання на неіснуючий файл: ' + rel)
    data = p.read_bytes()
    if p.suffix in ('.css', '.js', '.svg'):
        data = data.replace(b'\r\n', b'\n')   # хеш не залежить від autocrlf: на Windows файли в робочій теці з CRLF, на сервері з LF
    return hashlib.sha1(data).hexdigest()[:8]


def stamp(html: str) -> str:
    return ASSET.sub(lambda m: '%s?v=%s' % (m.group(1), file_hash(m.group(1))), html)


def build_page(name: str) -> str:
    with open(ROOT / name, encoding='utf-8', newline='') as fh:
        html = fh.read()
    if name == 'index.html':
        m = BLOCK.search(html)
        if not m:
            raise SystemExit('немає <style id="critical-css"> у index.html')
        html = html[:m.start(2)] + build_css() + html[m.end(2):]
    return stamp(html)


def main() -> int:
    check = '--check' in sys.argv
    bad = []
    for name in PAGES:
        with open(ROOT / name, encoding='utf-8', newline='') as fh:
            old = fh.read()
        new = build_page(name)
        if new == old:
            continue
        bad.append(name)
        if not check:
            with open(ROOT / name, 'w', encoding='utf-8', newline='') as fh:
                fh.write(new)
    if check:
        if bad:
            print('НЕ відповідає джерелам/версіям: %s – запустіть: py -3 tools/build_index.py' % ', '.join(bad))
            return 1
        print('ok: inline-CSS і ?v= відповідають файлам (inline-CSS %d байт)' % len(build_css().encode('utf-8')))
        return 0
    print('оновлено: %s' % (', '.join(bad) if bad else 'без змін'))
    return 0


if __name__ == '__main__':
    sys.exit(main())
