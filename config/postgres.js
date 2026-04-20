const { Pool } = require('pg');
require('dotenv').config();

const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;

const config = url
  ? {
      connectionString: url,
      ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
    }
  : {
      host: process.env.PGHOST || process.env.POSTGRES_HOST || 'localhost',
      port: parseInt(process.env.PGPORT || process.env.POSTGRES_PORT) || 5432,
      database: process.env.PGDATABASE || process.env.POSTGRES_DB || 'taskqueue',
      user: process.env.PGUSER || process.env.POSTGRES_USER || 'postgres',
      password: process.env.PGPASSWORD || process.env.POSTGRES_PASSWORD || 'yourpassword',
      max: 10,
      idleTimeoutMillis: 30000,
      ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
    };

const pool = new Pool(config);

pool.on('error', (err) => console.error('[Postgres] Unexpected error:', err.message));

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS jobs (
      id           VARCHAR(36) PRIMARY KEY,
      type         VARCHAR(100) NOT NULL,
      payload      JSONB NOT NULL DEFAULT '{}',
      status       VARCHAR(20) NOT NULL DEFAULT 'pending',
      priority     SMALLINT NOT NULL DEFAULT 0,
      attempts     SMALLINT NOT NULL DEFAULT 0,
      max_attempts SMALLINT NOT NULL DEFAULT 3,
      result       JSONB,
      error        TEXT,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
    CREATE INDEX IF NOT EXISTS idx_jobs_type   ON jobs(type);
  `);
  console.log('[Postgres] Tables ready');
}

module.exports = { pool, initDb };