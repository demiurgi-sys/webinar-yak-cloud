# Контекст проєкту

## Що зараз
Сайт-роздатка «Дизайнери, якими я надихаюся» (Grinevich School Design · Mood&Space, урок 03).
Аудиторія — чинні учні курсу, не продажний сайт. Концепція «Довідник з журнальною карткою»:
сітка 15 карток, перемикачі-фільтри (тоггли, не теги), картка в попапі + окрема сторінка /d/<id>/.

Вебінарний лендинг «Як стати дизайнером інтерʼєра» — НА ПАУЗІ (рішення власника).

## Технічні правила (ТЗ власника)
- Astro 7, `output: 'static'`, без SSR/адаптерів. Код у `main`, збірка `dist/` → корінь гілки `gh-pages` + `.nojekyll`.
- site `https://demiurgi-sys.github.io`, base `/webinar-yak-cloud`, усі шляхи від base.
- Тексти лише в `src/content/` (`designers/*.md`, `pages/*.md`, `site.json`); у `.astro` без захардкодженого тексту.
- Зображення лише через `astro:assets` (`src/assets/`); у `public/` тільки favicon.
- Жодних сторонніх скриптів, аналітики, CDN-шрифтів; шрифти локальні в `src/assets/fonts/`. JS — vanilla.
- У `<head>`: `<!-- TRACKING SLOT -->` і `<meta name="robots" content="noindex, nofollow">`. `lang="uk"`, mobile-first.
- Писати лише в `main` і `gh-pages` цього репо. PR не відкривати. Після кожної викатки — посилання
  https://demiurgi-sys.github.io/webinar-yak-cloud/
- Тексти Олени не переписувати без погодження; пропозиції — у `notes/perevirka.md`.

## Де що
- `ref/` — сайти-донори як є (webinar, course, myfavorite). Не частина збірки.
- `notes/perevirka.md` — фактчек субагентів, що можна дописати, 8 кандидатів у список.
