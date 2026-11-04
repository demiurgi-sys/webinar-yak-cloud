const { Pool } = require("pg");
const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
});

async function initDb() {
  await pool.query(`
    CREATE SCHEMA IF NOT EXISTS course;
    CREATE TABLE IF NOT EXISTS course.events (
      id SERIAL PRIMARY KEY,
      event_name VARCHAR(50) NOT NULL,
      event_id UUID NOT NULL,
      fbp VARCHAR(255),
      fbc VARCHAR(255),
      client_ip VARCHAR(45),
      client_user_agent TEXT,
      page_url TEXT,
      referrer TEXT,
      utm_source VARCHAR(255),
      utm_medium VARCHAR(255),
      utm_campaign VARCHAR(255),
      utm_content VARCHAR(255),
      utm_term VARCHAR(255),
      raw_payload JSONB,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);
}

module.exports = { pool, initDb };
