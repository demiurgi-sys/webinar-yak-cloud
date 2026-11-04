# Webinar Lead Capture System

Повний стек для збору лідів з лендингу, зберігання у PostgreSQL, видачі у SmartSender та відправки подій у Facebook CAPI.

## Архітектура

```
Лендинг (форма) → Nginx (web) → Node.js API (app) → PostgreSQL (db)
                                        ↓
                                  Facebook CAPI
                                        ↓
                            SmartSender ← GET /api/smartsender/lead
```

## Сервіси

| Сервіс | Опис | Порт |
|---|---|---|
| **db** | PostgreSQL 16 (не публікується назовні) | internal:5432 |
| **app** | Node.js API (Express) | internal:4000 |
| **web** | Nginx — роздає лендинг + проксі `/api` | **80** |

## Швидкий старт

```bash
# 1. Копіюємо приклади .env
cp .env.example .env
cp api/.env.example api/.env

# 2. Редагуємо паролі і FB-токени
#    - .env              — POSTGRES_PASSWORD
#    - api/.env          — FB_PIXEL_ID, FB_ACCESS_TOKEN, ALLOWED_ORIGINS

# 3. Запуск
docker-compose up -d

# 4. Перевірка
curl http://localhost/healthz
# → {"ok":true,"ts":...}
```

## Endpoints API

| Метод | URL | Опис |
|---|---|---|
| POST | `/api/submit` | Прийом форми з лендингу (alias: `/api/leads`, `/lead.php`) |
| GET  | `/api/smartsender/lead?lead_id=...` (або `?id=`) | Віддача ліда у SmartSender |
| POST | `/api/fb/convert` | Відправка події у Facebook CAPI |
| GET  | `/healthz` | Health-check |

## Формат відповіді `/api/submit`

```json
{
  "ok": true,
  "lead_id": "abc123xyz0",           // короткий ID для посилання в Telegram
  "uuid": "550e8400-e29b-41d4-...",  // повний UUID
  "redirect_url": "https://t.me/GrinevichSchooldesign2023_bot?start=web_reg_291026-abc123xyz0"
}
```

## SmartSender: вхід з лендінга

Мітка ефіру – `web_reg_<ддммрр>` (зараз `web_reg_291026`): дефолт у `api/src/index.js`, env `SMARTSENDER_START_CONTEXT` (перебиває дефолт), запасна – `startContext` в `assets/js/app.js`.

1. Бекенд віддає `redirect_url` `https://t.me/GrinevichSchooldesign2023_bot?start=web_reg_<ддммрр>-<short_id>`.
2. Довільне посилання `web_reg_<ддммрр>` у SmartSender пише суфікс після `-` у змінну `lead_id` і робить 2 дії по порядку: тег `reg_<ддммрр>` → підписка на воронку ефіру `<Когорта> <ддммрр> · 1 прогрів`.
3. У воронці – зовнішній GET `https://api.school-design.space/api/smartsender/lead?lead_id={{ lead_id }}`; відповідь мапиться у змінні контакту (`$.lead.lead_email` → `lead_email`, `$.lead.fbp` → `fbp` тощо) і йде в CAPI.

## Логи

```bash
docker-compose logs -f app     # логи Node.js
docker-compose logs -f db      # логи PostgreSQL
docker-compose logs -f web     # логи Nginx
```

## Перевірка таблиці `leads`

```bash
docker exec -it webinar_db psql -U webinar_user -d webinar_leads -c "SELECT COUNT(*) FROM leads;"
docker exec -it webinar_db psql -U webinar_user -d webinar_leads -c "\d leads"
```

## Журнал торкань `touches` (історія всіх utm / click-id)

`leads` тримає ЛИШЕ останній дотик: повторна реєстрація того самого email перетирає utm і fbclid
(`gclid` — виняток, лишається перший). `touches` — журнал, що не перетирається: один рядок на кожну
реєстрацію (`event_type = webinar_register`), і нову, і повторну. Код — `api/src/touches.js`,
схема створюється сама при старті API (як міграції `leads`).

Універсально для платформ: click-id лежать словником `click_ids` (`fbclid` — Meta, `gclid`/`gbraid`/`wbraid` —
Google і YouTube, `ttclid` — TikTok, будь-що на `…clid` — приймається без зміни коду). Незамінені макроси
кабінетів (`{{campaign.name}}`, `{lpurl}`) відсіюються. `referrer` шле фронт (`document.referrer`).

Історія починається з дня деплою. Торкань без реєстрації (просто зайшов на сайт) таблиця не бачить — це свідомо.

### Усі параметри адреси: `params`

І `leads`, і `touches` мають колонку `params` (jsonb) — словник УСІХ параметрів адреси сторінки на момент
реєстрації (`paramsFrom` у `api/src/touches.js`). Нова мітка в оголошенні (`adset_name`, `campaign_id`, будь-що
з іншого кабінету) лягає в базу без правки коду й фронту. Поверх адреси кладуться фактичні `utm_*`/`fbclid`/
`gclid`/`trigger`, тож `params->>'utm_source'` на практиці збігається з колонкою `utm_source` (розбіжність
можлива лише на сміттєвому вводі: інший регістр ключа, значення довше 512). Стелі: ключ до 40 символів,
значення до 512, не більше 30 ключів; незамінені макроси, NUL і розрізані емодзі відсіюються.

Відоме обмеження: запасний шлях фронту (localStorage, коли на момент відправки в адресі вже нема міток)
пам'ятає лише `utm_*`, `fbclid`, `gclid`. У такого ліда utm будуть, а `adset_name` і ID — ні.

У `leads` чотири іменовані колонки — похідні (`GENERATED`) від `params`: `adset_name`, `campaign_id`,
`adset_id`, `ad_id`. Ще одна іменована колонка = один рядок у списку в `api/src/db.js`, INSERT не чіпати.
`GET /api/smartsender/lead` віддає ці чотири поля поруч з `utm_*`.

Рядок міток для Meta («Параметри URL» оголошення):

```
utm_source={{site_source_name}}&utm_medium=paid_social&utm_campaign={{campaign.name}}&utm_content={{ad.name}}&utm_term={{placement}}&adset_name={{adset.name}}&campaign_id={{campaign.id}}&adset_id={{adset.id}}&ad_id={{ad.id}}
```

```bash
# перший дотик кожної людини
docker exec -it webinar_db psql -U webinar_user -d webinar_leads -c "SELECT DISTINCT ON (lead_id) lead_id, created_at, utm_source, utm_medium, utm_campaign, click_ids FROM touches WHERE NOT is_test ORDER BY lead_id, created_at;"

# повний шлях однієї людини по порядку
docker exec -it webinar_db psql -U webinar_user -d webinar_leads -c "SELECT created_at, event_type, lead_is_new, utm_source, utm_medium, utm_campaign, utm_content, click_ids, referrer FROM touches WHERE lead_id = (SELECT lead_id FROM leads WHERE lead_email = 'x@y.z') ORDER BY created_at;"

# шлях до покупки для всіх покупців (запрацює, коли каса почне писати event_type = purchase)
docker exec -it webinar_db psql -U webinar_user -d webinar_leads -c "SELECT lead_id, string_agg(utm_source || '/' || utm_campaign, ' > ' ORDER BY created_at) AS path FROM touches WHERE lead_id IN (SELECT lead_id FROM touches WHERE event_type = 'purchase') GROUP BY lead_id;"

# ліди по аудиторіях (групах оголошень)
docker exec -it webinar_db psql -U webinar_user -d webinar_leads -c "SELECT adset_name, count(*) FROM leads WHERE NOT is_test AND created_at > now() - interval '14 days' GROUP BY 1 ORDER BY 2 DESC;"

# ліди по довільній мітці, для якої іменованої колонки ще нема
docker exec -it webinar_db psql -U webinar_user -d webinar_leads -c "SELECT params->>'some_new_tag' AS tag, count(*) FROM leads WHERE NOT is_test GROUP BY 1 ORDER BY 2 DESC;"

# самоперевірка після деплою: торкань за добу не менше, ніж реєстрацій
docker exec -it webinar_db psql -U webinar_user -d webinar_leads -c "SELECT (SELECT count(*) FROM touches WHERE created_at > now() - interval '1 day') AS touches, (SELECT count(*) FROM leads WHERE updated_at > now() - interval '1 day') AS leads;"
```

Тести (без бази, чисті функції): `cd api && npm test`.

## Оновлення коду

```bash
git pull
docker-compose build app
docker-compose up -d
```

## TODO / Next steps

- [ ] SSL через Let's Encrypt (додати `certbot` або перевести web за Traefik/Caddy)
- [ ] Rate-limiting на `/api/submit` (захист від спаму)
- [ ] Валідація email/phone на бекенді
- [ ] Bearer-токен для `/api/smartsender/lead`
- [ ] Резервні копії БД (volumes → S3 nightly)
