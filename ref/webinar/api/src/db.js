import pg from 'pg';
import { initTouchesSchema } from './touches.js';

const { Pool } = pg;

export function createPool() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL is required');
  }

  return new Pool({
    connectionString,
    ssl: process.env.PGSSLMODE === 'require' ? { rejectUnauthorized: false } : undefined,
    max: Number.parseInt(process.env.PGPOOL_MAX ?? '10', 10),
  });
}

export async function initSchema(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS leads (
      id BIGSERIAL PRIMARY KEY,
      lead_id TEXT NOT NULL UNIQUE,
      short_id TEXT NOT NULL UNIQUE,
      lead_email TEXT NOT NULL UNIQUE,
      lead_phone TEXT NOT NULL DEFAULT '',
      utm_source TEXT NOT NULL DEFAULT '',
      utm_medium TEXT NOT NULL DEFAULT '',
      utm_campaign TEXT NOT NULL DEFAULT '',
      utm_content TEXT NOT NULL DEFAULT '',
      utm_term TEXT NOT NULL DEFAULT '',
      fbclid TEXT NOT NULL DEFAULT '',
      gclid TEXT NOT NULL DEFAULT '',
      fbp TEXT NOT NULL DEFAULT '',
      fbc TEXT NOT NULL DEFAULT '',
      "trigger" TEXT NOT NULL DEFAULT '',
      token TEXT NOT NULL DEFAULT '',
      page_url TEXT NOT NULL DEFAULT '',
      landing_url TEXT NOT NULL DEFAULT '',
      referrer TEXT NOT NULL DEFAULT '',
      event_id TEXT NOT NULL DEFAULT '',
      client_ip_address TEXT NOT NULL DEFAULT '',
      client_user_agent TEXT NOT NULL DEFAULT '',
      country TEXT NOT NULL DEFAULT '',
      city TEXT NOT NULL DEFAULT '',
      state TEXT NOT NULL DEFAULT '',
      zip TEXT NOT NULL DEFAULT '',
      device_type TEXT NOT NULL DEFAULT '',
      browser TEXT NOT NULL DEFAULT '',
      os TEXT NOT NULL DEFAULT '',
      language TEXT NOT NULL DEFAULT '',
      screen_resolution TEXT NOT NULL DEFAULT '',
      viewport TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'new',
      raw_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  // Міграція для існуючих баз: додаємо відсутні колонки, якщо таблиця вже була створена за старою схемою.
  const addColumnIfNotExists = async (col, definition) => {
    await pool.query(`ALTER TABLE leads ADD COLUMN IF NOT EXISTS ${col} ${definition};`);
  };
  await addColumnIfNotExists('short_id', `TEXT NOT NULL DEFAULT ''`);
  await addColumnIfNotExists('gclid', `TEXT NOT NULL DEFAULT ''`);
  await addColumnIfNotExists('city', `TEXT NOT NULL DEFAULT ''`);
  await addColumnIfNotExists('state', `TEXT NOT NULL DEFAULT ''`);
  await addColumnIfNotExists('zip', `TEXT NOT NULL DEFAULT ''`);
  await addColumnIfNotExists('event_id', `TEXT NOT NULL DEFAULT ''`);
  await addColumnIfNotExists('landing_url', `TEXT NOT NULL DEFAULT ''`);
  // Тестовий лід (свій домен / test-qa-demo-noreply префікс) — зберігається як завжди,
  // але гейт /api/fb/convert по цьому прапорцю не пускає подію в Facebook CAPI.
  await addColumnIfNotExists('is_test', `BOOLEAN NOT NULL DEFAULT false`);
  // Усі параметри адреси сторінки словником (див. paramsFrom у touches.js) —
  // нова мітка реклами лягає сюди без правки коду.
  await addColumnIfNotExists('params', `JSONB NOT NULL DEFAULT '{}'::jsonb`);
  // Іменовані колонки під мітки, про які вже домовились, — похідні від params:
  // INSERT їх не чіпає. Нова іменована колонка = один рядок тут.
  for (const key of ['adset_name', 'campaign_id', 'adset_id', 'ad_id']) {
    await addColumnIfNotExists(key, `TEXT GENERATED ALWAYS AS (COALESCE(params->>'${key}', '')) STORED`);
  }

  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS leads_lead_id_uidx ON leads (lead_id);`);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS leads_short_id_uidx ON leads (short_id);`);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS leads_email_uidx ON leads (lead_email);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS leads_phone_idx ON leads (lead_phone);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS leads_created_at_idx ON leads (created_at DESC);`);

  // Журнал торкань (історія всіх utm/click-id кожної людини) — див. touches.js
  await initTouchesSchema(pool);
}
