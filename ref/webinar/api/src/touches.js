// =============================================================
// Торкання (touches) — історія ВСІХ рекламних міток кожної людини.
// =============================================================
// leads лишається «останнім дотиком»: при повторній реєстрації того самого
// email його utm/fbclid перетираються. touches — журнал, що не перетирається:
// один рядок на кожну подію (зараз — реєстрація на вебінар; далі тим самим
// викликом — клік «Забронювати», оплата, вхід на ефір).
//
// Універсально для платформ: click-id не окремими колонками, а словником
// click_ids (fbclid для Meta, gclid/gbraid/wbraid для Google і YouTube,
// ttclid для TikTok, msclkid для Microsoft …). Нова платформа = нічого не міняти.
//
// Історія починається з дня деплою; торкань без реєстрації (просто зайшов на
// сайт) таблиця не бачить — їх бачать лише піксель/тег платформ. Це свідомо.

const KNOWN_CLICK_IDS = new Set([
  'fbclid', // Meta
  'gclid', 'gbraid', 'wbraid', 'dclid', // Google Ads / YouTube / DV360
  'ttclid', // TikTok
  'msclkid', // Microsoft Ads
  'yclid', // Yandex
  'li_fat_id', // LinkedIn
  'twclid', // X/Twitter
  'epik', // Pinterest
  'sccid', // Snapchat
  'rdt_cid', // Reddit
]);

// Будь-який ключ зі списку або будь-що на «…clid» — щоб не правити код під
// кожну нову платформу.
export function isClickIdKey(key) {
  const k = String(key || '').toLowerCase();
  return KNOWN_CLICK_IDS.has(k) || /clid$/.test(k);
}

// Незамінені макроси рекламних кабінетів ({{campaign.name}} у Meta,
// {lpurl} у Google) — це не значення, а помилка в оголошенні. Не пишемо.
export function cleanValue(v) {
  const s = typeof v === 'string' ? v.trim() : '';
  if (s.includes('{{') || /^\{[a-z_]+\}$/i.test(s)) return '';
  return s;
}

// Збирає click-id з page_url і з тіла запиту. Тіло пріоритетніше (той самий
// порядок, що в eff для utm: тіло → page_url).
// Стелі проти сміття: ключ до 40 символів, значення до 512, не більше 10 id.
const MAX_KEY = 40;
const MAX_VAL = 512;
const MAX_CLICK_IDS = 10;

// Обрізання, безпечне для jsonb: Postgres не приймає в jsonb ні NUL (\u0000),
// ні самотній сурогат (половинку емодзі, яку slice лишає на межі) — INSERT
// падає цілком. NUL прибираємо, розрізану пару зрізаємо, решту битих
// сурогатів міняємо на U+FFFD.
export function clip(v, max = MAX_VAL) {
  return String(v ?? '')
    .replace(/\u0000/g, '')
    .slice(0, max)
    .replace(/[\uD800-\uDBFF]$/, '')
    .toWellFormed();
}

export function clickIdsFrom(pageUrl, body = {}) {
  const out = {};
  const put = (k, v) => {
    const key = String(k || '').toLowerCase();
    const val = clip(cleanValue(v));
    if (!isClickIdKey(key) || key.length > MAX_KEY || !val) return;
    if (!Object.hasOwn(out, key) && Object.keys(out).length >= MAX_CLICK_IDS) return;
    out[key] = val;
  };
  try {
    const p = new URL(String(pageUrl || '')).searchParams;
    for (const [k, v] of p.entries()) put(k, v);
  } catch (e) {
    // page_url порожній або битий — беремо лише з тіла
  }
  for (const [k, v] of Object.entries(body || {})) put(k, v);
  return out;
}

// params — УСІ параметри адреси сторінки словником: нова мітка в оголошенні
// (adset_name, campaign_id, будь-що з іншого кабінету) лягає в базу без правки
// коду. Поверх адреси кладуться фактичні значення eff (utm_*/fbclid/gclid/trigger),
// щоб params->>'utm_source' не розходився з колонкою utm_source: фронт може
// принести utm з localStorage, коли в адресі їх уже нема.
// Стелі проти сміття: ключ до 40 символів, значення до 512, не більше 30 ключів.
const MAX_PARAMS = 30;

export function paramsFrom(pageUrl, eff = {}) {
  const out = {};
  const put = (k, v) => {
    const key = clip(k, MAX_KEY + 1).trim().toLowerCase();
    const val = clip(cleanValue(v));
    // Object.hasOwn, не `in`: інакше параметр з назвою `constructor` губився б мовчки
    if (!key || key.length > MAX_KEY || !val || Object.hasOwn(out, key)) return true;
    if (Object.keys(out).length >= MAX_PARAMS) return false;
    out[key] = val;
    return true;
  };
  // eff першим: він пріоритетніший за адресу і не має випасти через стелю
  for (const [k, v] of Object.entries(eff || {})) put(k, v);
  let dropped = 0;
  try {
    const p = new URL(String(pageUrl || '')).searchParams;
    for (const [k, v] of p.entries()) if (!put(k, v)) dropped += 1;
  } catch (e) {
    // page_url порожній або битий — лишається тільки шар eff
  }
  if (dropped) console.warn(`[params] truncated: відкинуто ${dropped} параметрів понад стелю ${MAX_PARAMS}`);
  return out;
}

// raw — лише мітки, білим списком і з обрізанням. Не весь payload: тіло до
// 1 МБ на кожен POST лягало б у журнал без дедуплікації.
const RAW_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'trigger', 'fbp', 'fbc', 'referrer'];
export function rawFor(body = {}) {
  const out = {};
  for (const [k, v] of Object.entries(body || {})) {
    if (!RAW_KEYS.includes(k) && !isClickIdKey(k)) continue;
    if (k.length > MAX_KEY) continue;
    const s = typeof v === 'string' ? v : v == null ? '' : String(v);
    out[k] = clip(s);
  }
  return out;
}

// Чиста адреса сторінки без query — те саме, що landing_url у leads.
export function landingUrlOf(pageUrl) {
  try {
    const u = new URL(String(pageUrl || ''));
    return u.origin + u.pathname;
  } catch (e) {
    return '';
  }
}

// Колонки поза первинним ключем — одне джерело і для CREATE, і для ALTER.
const TOUCHES_COLUMNS = [
  ['created_at', 'TIMESTAMPTZ NOT NULL DEFAULT NOW()'],
  ['lead_id', "TEXT NOT NULL DEFAULT ''"],
  ['event_type', "TEXT NOT NULL DEFAULT ''"],
  ['event_id', "TEXT NOT NULL DEFAULT ''"],
  ['lead_is_new', 'BOOLEAN NOT NULL DEFAULT false'],
  ['is_test', 'BOOLEAN NOT NULL DEFAULT false'],
  ['utm_source', "TEXT NOT NULL DEFAULT ''"],
  ['utm_medium', "TEXT NOT NULL DEFAULT ''"],
  ['utm_campaign', "TEXT NOT NULL DEFAULT ''"],
  ['utm_content', "TEXT NOT NULL DEFAULT ''"],
  ['utm_term', "TEXT NOT NULL DEFAULT ''"],
  ['"trigger"', "TEXT NOT NULL DEFAULT ''"],
  ['click_ids', "JSONB NOT NULL DEFAULT '{}'::jsonb"],
  ['landing_url', "TEXT NOT NULL DEFAULT ''"],
  ['page_url', "TEXT NOT NULL DEFAULT ''"],
  ['referrer', "TEXT NOT NULL DEFAULT ''"],
  ['client_ip_address', "TEXT NOT NULL DEFAULT ''"],
  ['client_user_agent', "TEXT NOT NULL DEFAULT ''"],
  ['raw', "JSONB NOT NULL DEFAULT '{}'::jsonb"],
  ['params', "JSONB NOT NULL DEFAULT '{}'::jsonb"],
];

// Схема. Викликається з initSchema у db.js при старті API — так само, як
// міграції leads (CREATE/ALTER IF NOT EXISTS, без окремого інструмента).
// FK на leads.lead_id свідомо нема: наступні події (каса, ефір) можуть прийти
// раніше за рядок ліда або з іншого джерела.
export async function initTouchesSchema(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS touches (
      id BIGSERIAL PRIMARY KEY,
      ${TOUCHES_COLUMNS.map(([c, d]) => `${c} ${d}`).join(',\n      ')}
    );
  `);
  // Добудова колонок для бази, де таблиця вже була (той самий патерн, що в leads):
  // інакше INSERT тихо падав би в catch, а журнал стояв порожнім при зелених логах.
  for (const [col, def] of TOUCHES_COLUMNS) {
    await pool.query(`ALTER TABLE touches ADD COLUMN IF NOT EXISTS ${col} ${def};`);
  }
  await pool.query(`CREATE INDEX IF NOT EXISTS touches_lead_created_idx ON touches (lead_id, created_at);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS touches_created_at_idx ON touches (created_at DESC);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS touches_event_type_idx ON touches (event_type);`);
}

// Один рядок торкання. Не кидає помилок назовні: журнал не має ламати
// реєстрацію — збій лише в лог. Повертає true/false.
export async function recordTouch(pool, t) {
  try {
    await pool.query(
      `INSERT INTO touches (
         lead_id, event_type, event_id, lead_is_new, is_test,
         utm_source, utm_medium, utm_campaign, utm_content, utm_term, "trigger",
         click_ids, landing_url, page_url, referrer,
         client_ip_address, client_user_agent, raw, params
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)`,
      [
        t.lead_id || '',
        t.event_type || '',
        t.event_id || '',
        t.lead_is_new === true,
        t.is_test === true,
        t.utm_source || '',
        t.utm_medium || '',
        t.utm_campaign || '',
        t.utm_content || '',
        t.utm_term || '',
        t.trigger || '',
        JSON.stringify(t.click_ids || {}),
        t.landing_url || '',
        String(t.page_url || '').slice(0, 2048),
        clip(cleanValue(t.referrer)),
        t.client_ip_address || '',
        t.client_user_agent || '',
        JSON.stringify(t.raw || {}),
        JSON.stringify(t.params || {}),
      ],
    );
    return true;
  } catch (error) {
    console.error('[touch] insert failed (реєстрацію не зачіпає):', error.message);
    return false;
  }
}
