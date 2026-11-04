import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import crypto from 'node:crypto';
import { nanoid } from 'nanoid';
import { createPool, initSchema } from './db.js';
import { sendEvent, hash, normalizePhone, countryFromPhone } from './facebook-capi.js';
import { clickIdsFrom, recordTouch, rawFor, landingUrlOf, paramsFrom } from './touches.js';

const app = express();
const port = Number.parseInt(process.env.PORT || '4000', 10);
const pool = createPool();

app.disable('x-powered-by');
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

// CORS — дозволяємо лендинг (налаштовується через ALLOWED_ORIGINS у .env)
const allowedOrigins = (process.env.ALLOWED_ORIGINS || '*')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
app.use(
  cors({
    origin: allowedOrigins.includes('*') ? '*' : allowedOrigins,
    credentials: false,
  }),
);

// Тривіальний health-check для docker healthcheck
app.get('/healthz', (req, res) => res.json({ ok: true, ts: Date.now() }));

// Реальний IP відвідувача за ланцюгом Cloudflare → Traefik → nginx → Node.
// Раніше писався 172.18.0.2 (IP Docker-проксі), бо nginx ставив X-Real-IP = $remote_addr.
// Пріоритет: CF-Connecting-IP (справжній IP від Cloudflare) → True-Client-IP →
// X-Real-IP / перший у X-Forwarded-For → сокет (внутрішній IP проксі — останній шанс).
// Meta CAPI прямо вимагає реальний IP: "Always provide the real IP address".
function getClientIp(req) {
  return (
    req.headers['cf-connecting-ip'] ||
    req.headers['true-client-ip'] ||
    req.headers['x-real-ip'] ||
    req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
    req.socket.remoteAddress ||
    ''
  );
}

// Фолбек міток: фронт може не донести utm/trigger (localStorage недоступний у
// вбудованих браузерах IG/FB), але повний URL з мітками завжди є в page_url.
function trackingFromUrl(pageUrl) {
  try {
    const p = new URL(String(pageUrl || '')).searchParams;
    // незамінені плейсхолдери Meta ({{site_source_name}} тощо) не пишемо
    const pick = (k) => {
      const v = p.get(k) || '';
      return v.includes('{{') ? '' : v;
    };
    return {
      utm_source: pick('utm_source'),
      utm_medium: pick('utm_medium'),
      utm_campaign: pick('utm_campaign'),
      utm_content: pick('utm_content'),
      utm_term: pick('utm_term'),
      fbclid: pick('fbclid'),
      gclid: pick('gclid'),
      trigger: pick('trigger'),
    };
  } catch (e) {
    return {};
  }
}

// =============================================================
// Валідація email/phone + гейт тестових лідів
// =============================================================
// Структура local@domain.tld, TLD від 2 літер. '+' у локальній частині
// (плюс-адресація) свідомо дозволений — регекс його не забороняє.
// TLD НЕ обмежуємо списком (сам сайт живе на .space).
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[a-zA-Z]{2,}$/;
function isValidEmail(v) {
  return EMAIL_RE.test(String(v || '').trim());
}
function digitsOnly(v) {
  return String(v || '').replace(/\D/g, '');
}
// Межі E.164: 7-15 цифр. Без прив'язки до коду країни 380 — форма приймає
// й іноземні номери (preferredCountries у app.js: ua/pl/de/us).
function isValidPhone(v) {
  const d = digitsOnly(v);
  return d.length >= 7 && d.length <= 15;
}
// Тестові домени (свій стек) + типові префікси QA/автотестів.
const TEST_EMAIL_DOMAINS = ['school-design.space', 'demiurgi.com'];
const TEST_EMAIL_PREFIXES = ['test', 'qa', 'demo', 'noreply'];
function isTestLead(emailRaw) {
  const v = String(emailRaw || '').trim().toLowerCase();
  const at = v.indexOf('@');
  if (at === -1) return false;
  const local = v.slice(0, at);
  const domain = v.slice(at + 1);
  if (TEST_EMAIL_DOMAINS.includes(domain)) return true;
  return TEST_EMAIL_PREFIXES.some((p) => local.startsWith(p));
}

// =============================================================
// POST /api/submit (alias: /api/leads, /lead.php) — прийом форми
// =============================================================
app.post(['/api/submit', '/api/leads', '/lead.php'], async (req, res) => {
  try {
    console.log('[DEBUG] Submit Body:', JSON.stringify(req.body));
    const { email, phone, trigger, fbp, fbc, user_agent, page_url, event_id, referrer, ...payload } = req.body;

    if (!isValidEmail(email)) {
      console.warn('[submit] rejected invalid email:', JSON.stringify(email));
      return res.status(400).json({ error: 'invalid_lead', field: 'email', msg: 'Некоректний email' });
    }
    if (!isValidPhone(phone)) {
      console.warn('[submit] rejected invalid phone:', JSON.stringify(phone));
      return res.status(400).json({ error: 'invalid_lead', field: 'phone', msg: 'Некоректний номер телефону' });
    }
    const is_test = isTestLead(email);
    if (is_test) {
      console.log('[submit] test lead saved (excluded from FB later):', email);
    }

    const fromUrl = trackingFromUrl(page_url);
    // плейсхолдери {{...}} відсіюємо і з ТІЛА: фронт тепер теж читає мітки з URL,
    // тож незамінений макрос Meta може прийти пріоритетним шляхом
    const noPh = (v) => (typeof v === 'string' && v.includes('{{') ? '' : v || '');
    const eff = {
      trigger: noPh(trigger) || fromUrl.trigger || '',
      utm_source: noPh(payload.utm_source) || fromUrl.utm_source || '',
      utm_medium: noPh(payload.utm_medium) || fromUrl.utm_medium || '',
      utm_campaign: noPh(payload.utm_campaign) || fromUrl.utm_campaign || '',
      utm_content: noPh(payload.utm_content) || fromUrl.utm_content || '',
      utm_term: noPh(payload.utm_term) || fromUrl.utm_term || '',
      fbclid: noPh(payload.fbclid) || fromUrl.fbclid || '',
      gclid: noPh(payload.gclid) || fromUrl.gclid || '',
    };
    // чиста адреса лендінга без query (колонка раніше не заповнювалась ніколи)
    const landing_url = landingUrlOf(page_url);
    // усі параметри адреси словником (+ фактичні eff поверх) — для leads і touches
    const params = paramsFrom(page_url, eff);

    const client_ip = getClientIp(req);
    const client_ua = user_agent || req.headers['user-agent'];

    // Власний примітивний генератор, який 1000% гарантує відсутність дефісів:
    const generateSafeId = () => {
      const chars = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
      let result = '';
      for (let i = 0; i < 10; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
      }
      return result;
    };

    const lead_id = crypto.randomUUID();
    const short_id = generateSafeId();
    const eid = event_id || `reg_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;

    const query = `
      INSERT INTO leads (
        lead_id, short_id, lead_email, lead_phone, "trigger",
        fbp, fbc, client_ip_address, client_user_agent, page_url,
        utm_source, utm_medium, utm_campaign, utm_content, utm_term,
        fbclid, gclid, event_id, raw_payload, landing_url, is_test, params
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22)
      ON CONFLICT (lead_email) DO UPDATE SET
        -- short_id = EXCLUDED.short_id, (НЕ міняємо ID при повторній реєстрації)
        lead_phone = EXCLUDED.lead_phone,
        "trigger" = EXCLUDED."trigger",
        fbp = EXCLUDED.fbp,
        fbc = EXCLUDED.fbc,
        client_ip_address = EXCLUDED.client_ip_address,
        client_user_agent = EXCLUDED.client_user_agent,
        page_url = EXCLUDED.page_url,
        utm_source = EXCLUDED.utm_source,
        utm_medium = EXCLUDED.utm_medium,
        utm_campaign = EXCLUDED.utm_campaign,
        utm_content = EXCLUDED.utm_content,
        utm_term = EXCLUDED.utm_term,
        fbclid = EXCLUDED.fbclid,
        -- gclid = EXCLUDED.gclid,
        event_id = EXCLUDED.event_id,
        raw_payload = EXCLUDED.raw_payload,
        landing_url = EXCLUDED.landing_url,
        is_test = EXCLUDED.is_test,
        params = EXCLUDED.params,
        updated_at = NOW()
      RETURNING short_id, lead_id, event_id, (xmax = 0) AS is_new
    `;

    const values = [
      lead_id,
      short_id,
      email || '',
      phone || '',
      eff.trigger,
      fbp || '',
      fbc || '',
      client_ip || '',
      client_ua || '',
      page_url || '',
      eff.utm_source,
      eff.utm_medium,
      eff.utm_campaign,
      eff.utm_content,
      eff.utm_term,
      eff.fbclid,
      eff.gclid,
      eid,
      // _tracking_effective — чим ФАКТИЧНО заповнились колонки (тіло сире,
      // фолбек з page_url у ньому не видно — без цього дебаг вводить в оману)
      JSON.stringify({ ...payload, fbp, fbc, event_id: eid, client_ip, client_ua, _tracking_effective: eff }),
      landing_url,
      is_test,
      JSON.stringify(params),
    ];

    const { rows } = await pool.query(query, values);
    const stored = rows[0] || { short_id, lead_id, event_id: eid };

    // Журнал торкань: рядок на КОЖНУ реєстрацію — і нову, і повторну з тим самим
    // email (у leads повтор перетирає мітки, тут — ні). lead_id береться з
    // RETURNING, тож при повторі це id старого ліда. Без await: журнал не в
    // критичному шляху — при насиченому пулі реєстрація не має чекати 504.
    // recordTouch сам ловить помилки (лише лог), тож catch тут — страховка.
    recordTouch(pool, {
      lead_id: stored.lead_id,
      event_type: 'webinar_register',
      event_id: stored.event_id,
      lead_is_new: stored.is_new === true,
      is_test,
      utm_source: eff.utm_source,
      utm_medium: eff.utm_medium,
      utm_campaign: eff.utm_campaign,
      utm_content: eff.utm_content,
      utm_term: eff.utm_term,
      trigger: eff.trigger,
      click_ids: clickIdsFrom(page_url, payload),
      landing_url,
      page_url: page_url || '',
      referrer,
      client_ip_address: client_ip,
      client_user_agent: client_ua,
      // лише мітки, білим списком і з обрізанням (без email/phone — вони в leads)
      raw: rawFor({ ...payload, trigger, fbp, fbc, referrer }),
      params,
    }).catch((e) => console.error('[touch] unexpected:', e && e.message));

    // Формуємо redirect URL для SmartSender (формат: web_reg_3008-{short_id})
    const bot = process.env.TELEGRAM_BOT || 'GrinevichSchooldesign2023_bot';
    const startContext = process.env.SMARTSENDER_START_CONTEXT || 'web_reg_051126';
    const redirect_url = `https://t.me/${bot}?start=${startContext}-${stored.short_id}`;

    res.status(201).json({
      ok: true,
      lead_id: stored.short_id,  // коротке id, яке летить у SmartSender через ?start
      uuid: stored.lead_id,       // повний UUID
      event_id: stored.event_id,  // для дедуплікації FB CAPI ↔ pixel
      // Серверний гейт зупиняє лише CAPI. Браузерний піксель стріляє з фронту,
      // тож повідомляємо йому, що лід тестовий — інакше тестова конверсія
      // однаково полетіла б у Meta пікселем, в обхід гейта.
      is_test,
      redirect_url,
    });
  } catch (error) {
    console.error('[submit] error:', error);
    res.status(500).json({ error: 'db_error', msg: error.message });
  }
});

// Зберігаємо short_id з останнього GET (для бронежилету в fb/convert)
let lastSmartSenderShortId = null;
let lastSmartSenderTime = 0;

// =============================================================
// GET /api/smartsender/lead?id=... — SmartSender забирає дані
// =============================================================
app.get('/api/smartsender/lead', async (req, res) => {
  try {
    console.log('[DEBUG] SmartSender GET ID:', req.query.id);
    // SmartSender шле параметр по-різному: ROUTER — ?id=, воронка «Невгамовні» — ?lead_id=.
    // Приймаємо обидва, щоб міст не залежав від того, як зібрано конкретну воронку.
    let raw = String(req.query.id || req.query.lead_id || '').trim();
    if (!raw) return res.status(400).json({ error: 'id_required' });

    // SmartSender може прислати "web_reg_3008-abc123" — беремо останній сегмент
    let searchId = raw;
    if (raw.includes('-')) {
      const parts = raw.split('-');
      searchId = parts[parts.length - 1];
    }

    const { rows } = await pool.query(
      'SELECT * FROM leads WHERE short_id = $1 OR short_id = $2 OR lead_id = $2',
      [searchId, raw],
    );
    if (rows.length === 0) return res.status(404).json({ error: 'not_found' });

    const row = rows[0];
    // Запам'ятовуємо short_id для бронежилету (POST прийде через 1-5 сек після GET)
    lastSmartSenderShortId = row.short_id;
    lastSmartSenderTime = Date.now();
    console.log('[DEBUG] Saved lastSmartSenderShortId:', lastSmartSenderShortId);
    let rawPayload = row.raw_payload;
    if (typeof rawPayload === 'string') {
      try {
        rawPayload = JSON.parse(rawPayload);
      } catch {
        rawPayload = {};
      }
    }
    rawPayload = rawPayload || {};

    res.json({
      lead: {
        // === Системні ===
        lead_id: row.lead_id,
        external_id: row.lead_id,
        short_id: row.short_id,
        event_id: row.event_id || '',
        trigger: row.trigger,
        et: Math.floor(Date.now() / 1000),

        // === СИРІ дані (для картки клієнта в SmartSender, читабельно) ===
        lead_email: row.lead_email,
        lead_phone: row.lead_phone,
        email: row.lead_email,
        phone: row.lead_phone,
        fbFirstName: rawPayload.firstName || rawPayload.fbFirstName || '',
        fbLastName: rawPayload.lastName || rawPayload.fbLastName || '',
        fbCountry: rawPayload.country || rawPayload.fbCountry || '',
        country: rawPayload.country || '',
        city: rawPayload.city || '',
        state: rawPayload.state || '',
        zip: rawPayload.zip || '',

        // === ХЕШОВАНІ дані (для відправки у Facebook CAPI) ===
        // Примітка: fbEmail/fbPhone залишаємо як хеші — так історично
        // налаштовано в SmartSender, нічого не ламаємо.
        fbEmail: hash(row.lead_email),
        fbPhone: hash(normalizePhone(row.lead_phone)),
        // Нові окремі змінні для хешів ім'я/прізвища/країни:
        fbFirstName_hash: hash(rawPayload.firstName || rawPayload.fbFirstName || ''),
        fbLastName_hash: hash(rawPayload.lastName || rawPayload.fbLastName || ''),
        fbCountry_hash: hash(rawPayload.country || rawPayload.fbCountry || ''),

        // === Технічні (НЕ хешуються, потрібні як є) ===
        fbp: rawPayload.fbp || row.fbp || '',
        fbc: rawPayload.fbc || row.fbc || '',
        gclid: row.gclid || rawPayload.gclid || '',
        client_ip_address: rawPayload.client_ip_address || row.client_ip_address || '',
        client_user_agent: rawPayload.client_user_agent || row.client_user_agent || '',

        // === UTM ===
        utm_source: row.utm_source || '',
        utm_medium: row.utm_medium || '',
        utm_campaign: row.utm_campaign || '',
        utm_content: row.utm_content || '',
        utm_term: row.utm_term || '',

        // === Мітки Meta поза UTM (похідні колонки від params) ===
        adset_name: row.adset_name || '',
        campaign_id: row.campaign_id || '',
        adset_id: row.adset_id || '',
        ad_id: row.ad_id || '',
      },
    });
    console.log('[DEBUG] SmartSender Response sent for ID:', searchId);
  } catch (error) {
    console.error('[smartsender/lead] error:', error);
    res.status(500).json({ error: 'server_error', msg: error.message });
  }
});

// =============================================================
// POST /api/fb/convert — відправка події у Facebook CAPI
// =============================================================
app.post('/api/fb/convert', async (req, res) => {
  try {
    console.log('[DEBUG] FB Convert Body:', JSON.stringify(req.body), 'Query:', JSON.stringify(req.query));
    // SmartSender може слати поля і тілом (JSON/form), і query-параметрами — зливаємо, тіло пріоритетніше
    const src = { ...req.query, ...req.body };
    let {
      event_name,
      event_id,
      value,
      currency,
      email,
      phone,
      firstName,
      lastName,
      fbp,
      fbc,
      ip,
      ua,
      external_id,
      country,
      source_url,
      test_code,
    } = src;

    // СмартСендер може прислати нерозпаршені змінні як '{{event_id}}'. Очищуємо їх.
    if (event_id && (event_id.includes('{{') || event_id.trim() === '')) {
       event_id = null;
    }
    if (external_id && (external_id.includes('{{') || external_id.trim() === '')) {
       external_id = null;
    }
    if (email && email.includes('{{')) email = null;
    if (phone && phone.includes('{{')) phone = null;

    // Ідентифікація ліда + відновлення даних з БД.
    // Пріоритет ВІД НАЙНАДІЙНІШОГО ДО НАЙСЛАБШОГО (раніше глобальна змінна
    // lastSmartSenderShortId була ПЕРШОЮ — під паралельним трафіком це гонка:
    // дві реєстрації одночасно → подія ліда A могла піти з даними ліда B):
    //   1) external_id (lead_id, UUID) — прийшов від SmartSender напряму, найнадійніший;
    //   2) event_id з тіла — якщо не плейсхолдер (пошук по колонці event_id);
    //   3) email з тіла (пошук по lead_email);
    //   4) lastSmartSenderShortId — ОСТАННІЙ варіант, лише у вузькому 30-секундному
    //      вікні від моменту, коли SmartSender його запитав через GET.
    // Відновлення запускаємо не лише коли відсутній event_id, а й коли бракує
    // email/phone: SmartSender часто шле валідний event_id з порожніми/плейсхолдерними
    // email чи phone, і без цього кроку реальна конверсія летить у Facebook без
    // email/phone-хешу (просідає match quality) — саме ДЕФЕКТ 3.
    if (!event_id || !external_id || !email || !phone) {
        let searchQuery;
        let searchVal;

        if (external_id) {
            searchQuery = 'SELECT event_id, raw_payload, lead_id, lead_email, lead_phone FROM leads WHERE lead_id = $1 LIMIT 1';
            searchVal = [external_id];
        } else if (event_id) {
            searchQuery = 'SELECT event_id, raw_payload, lead_id, lead_email, lead_phone FROM leads WHERE event_id = $1 LIMIT 1';
            searchVal = [event_id];
        } else if (email) {
            searchQuery = 'SELECT event_id, raw_payload, lead_id, lead_email, lead_phone FROM leads WHERE lead_email = $1 ORDER BY created_at DESC LIMIT 1';
            searchVal = [email];
        } else {
            const getWasRecent = (Date.now() - lastSmartSenderTime) < 30000; // 30 сек
            if (lastSmartSenderShortId && getWasRecent) {
                searchQuery = 'SELECT event_id, raw_payload, lead_id, lead_email, lead_phone FROM leads WHERE short_id = $1 LIMIT 1';
                searchVal = [lastSmartSenderShortId];
            }
        }

        if (searchQuery) {
            try {
                const { rows } = await pool.query(searchQuery, searchVal);
                if (rows.length > 0) {
                     const row = rows[0];
                     event_id = event_id || row.event_id;
                     external_id = external_id || row.lead_id;
                     console.log('[DEBUG] Recovered lead from DB. event_id:', event_id, 'external_id:', external_id);

                     let rawPayload = row.raw_payload;
                     if (typeof rawPayload === 'string') {
                       try { rawPayload = JSON.parse(rawPayload); } catch { rawPayload = {}; }
                     }
                     rawPayload = rawPayload || {};

                     // email/phone — ЛИШЕ з колонок lead_email/lead_phone. raw_payload
                     // їх ніколи не містить: /api/submit деструктурує email/phone
                     // ОКРЕМО від ...payload перед збереженням (див. POST /api/submit
                     // вище) — rawPayload.email/rawPayload.phone завжди undefined.
                     // raw_payload лишається запасним лише для решти полів (fbp, fbc, client_ip).
                     if (!email) email = row.lead_email || '';
                     if (!phone) phone = row.lead_phone || '';
                     if (!ip || ip.includes('{{')) ip = rawPayload.client_ip || '';
                     if (!fbp || fbp.includes('{{')) fbp = rawPayload.fbp || '';
                     if (!fbc || fbc.includes('{{')) fbc = rawPayload.fbc || '';
                }
            } catch (dbErr) {
                console.error('[DEBUG] Failed to fetch from DB for recovery:', dbErr.message);
            }
        }
    }

    // Лід так і не ідентифікований — event_id/external_id/email відсутні і після
    // спроби відновлення. Ендпоінт публічний, без автентифікації (CORS *): раніше
    // тут був fallback БЕЗ WHERE (`ORDER BY created_at DESC LIMIT 1` по всій таблиці),
    // тож будь-який сторонній POST з порожнім тілом бив фейкову конверсію за
    // найсвіжішого реального ліда. Тепер — краще втратити подію, ніж приписати
    // чужу конверсію випадковій людині.
    if (!event_id && !external_id && !email) {
        console.warn('[fb/convert] lead not identified — refusing to send event. src=', JSON.stringify(src));
        return res.status(400).json({ error: 'lead_not_identified' });
    }

    // Гейт тестових лідів — ДО sendEvent(...). Спираємось і на колонку is_test
    // (спрацьовує теж для відновленого з БД ліда — external_id/email вище вже
    // могли підтягнутись із БД у блоці відновлення), і на живу перевірку email
    // з тіла запиту (SmartSender міг прислати інший email, ніж збережений).
    let dbIsTest = false;
    try {
        let idQuery, idVal;
        if (external_id) {
            idQuery = 'SELECT is_test FROM leads WHERE lead_id = $1 LIMIT 1';
            idVal = [external_id];
        } else if (email) {
            idQuery = 'SELECT is_test FROM leads WHERE lead_email = $1 ORDER BY created_at DESC LIMIT 1';
            idVal = [email];
        }
        if (idQuery) {
            const { rows } = await pool.query(idQuery, idVal);
            if (rows.length > 0) dbIsTest = !!rows[0].is_test;
        }
    } catch (dbErr) {
        console.error('[fb/convert] is_test lookup failed:', dbErr.message);
    }
    const emailIsTest = isTestLead(email);
    if (dbIsTest || emailIsTest) {
        console.log('[fb/convert] skipped test lead (db_is_test=%s, email_match=%s):', dbIsTest, emailIsTest, email);
        return res.json({ ok: true, skipped: 'test_lead' });
    }

    const client_ip = ip || getClientIp(req);

    // Незамінені змінні SmartSender ({{ firstName }} тощо) не шлемо як ім'я/країну
    const noPh = (v) => (typeof v === 'string' && !v.includes('{{') ? v.trim() : '');
    firstName = noPh(firstName);
    lastName = noPh(lastName);
    country = noPh(country).toLowerCase();

    // З ліда в базі добираємо те, чого SmartSender не передає:
    //  - тестовий код Events Manager (?fb_test=TEST… на сайті) — з raw_payload;
    //  - країну — з СИРОГО телефону (SmartSender шле лише хеш телефону).
    if ((!test_code || !country) && (external_id || email)) {
        try {
            const { rows } = await pool.query(
                external_id
                    ? 'SELECT raw_payload, lead_phone FROM leads WHERE lead_id = $1 LIMIT 1'
                    : 'SELECT raw_payload, lead_phone FROM leads WHERE lead_email = $1 ORDER BY created_at DESC LIMIT 1',
                [external_id || email],
            );
            let rp = rows[0]?.raw_payload;
            if (typeof rp === 'string') { try { rp = JSON.parse(rp); } catch { rp = {}; } }
            if (!test_code && rp && /^TEST\d+$/.test(rp.fb_test || '')) {
                test_code = rp.fb_test;
                console.log('[fb/convert] test_event_code from lead:', test_code);
            }
            if (!country) {
                country = countryFromPhone(rows[0]?.lead_phone);
                if (country) console.log('[fb/convert] country from phone:', country);
            }
        } catch (dbErr) {
            console.error('[fb/convert] lead lookup (fb_test/country) failed:', dbErr.message);
        }
    }

    const fb_response = await sendEvent({
      event_name: event_name || 'CompleteRegistration',
      event_id,
      user: { email, phone, firstName, lastName, country },
      browser: { fbp, fbc, ip: client_ip, ua, external_id },
      custom: value ? { value: parseFloat(value), currency: currency || 'USD' } : undefined,
      source_url: source_url || 'https://webinar.school-design.space/',
      test_code,
    });

    res.json({ ok: true, fb_response });
  } catch (error) {
    console.error('[fb/convert] error:', error.response?.data || error.message);
    res.status(500).json({ error: 'fb_error', details: error.response?.data || error.message });
  }
});

// =============================================================
// Запуск
// =============================================================
initSchema(pool)
  .then(() => {
    app.listen(port, () => console.log(`[api] listening on :${port}`));
  })
  .catch((err) => {
    console.error('[init] schema init failed:', err);
    process.exit(1);
  });
