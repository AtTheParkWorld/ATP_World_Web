const { Pool } = require('pg');
require('dotenv').config();

// Strip channel_binding from connection string if present
// (not supported by all pg versions)
const connStr = (process.env.DATABASE_URL || '')
  .replace(/&?channel_binding=require/, '')
  .replace(/\?channel_binding=require&?/, '?');

const pool = new Pool({
  connectionString: connStr,
  ssl: { rejectUnauthorized: false },
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});

pool.on('error', (err) => {
  console.error('Unexpected DB client error:', err);
});

const query = (text, params) => pool.query(text, params);

const transaction = async (callback) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

module.exports = { pool, query, transaction };
