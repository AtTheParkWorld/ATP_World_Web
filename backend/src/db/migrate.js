const fs = require('fs');
const path = require('path');
const { pool } = require('./index');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });

async function migrate() {
  const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  console.log('🗄️  Running ATP database migration...');
  try {
    await pool.query(sql);
    console.log('✅ Migration complete — all tables created');
  } catch (err) {
    if (err.message.includes('already exists')) {
      console.log('✅ Tables already exist — skipping migration');
    } else {
      console.error('❌ Migration failed:', err.message);
      process.exit(1);
    }
  } finally {
    await pool.end();
  }
}

migrate();
