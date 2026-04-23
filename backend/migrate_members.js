const { Pool } = require('pg');
const https = require('https');

const DB_URL = 'postgresql://neondb_owner:npg_qNs60frZUQhO@ep-icy-cake-amd4w7ga-pooler.c-5.us-east-1.aws.neon.tech/neondb?sslmode=require';
const SHEET_URL = 'https://docs.google.com/spreadsheets/d/1yalnFyBcT3f596VDEFlL1cCoxBVEOXpm7JLPUykQNDo/export?format=csv';

const pool = new Pool({ connectionString: DB_URL });

function fetchCSV(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        return fetchCSV(res.headers.location).then(resolve).catch(reject);
      }
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });
}

function parseCSV(text) {
  const lines = text.split('\n');
  const headers = lines[0].split(',').map(h => h.trim().replace(/"/g, ''));
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    // Handle quoted fields with commas inside
    const cols = [];
    let cur = '', inQuote = false;
    for (const ch of lines[i]) {
      if (ch === '"') { inQuote = !inQuote; }
      else if (ch === ',' && !inQuote) { cols.push(cur.trim()); cur = ''; }
      else cur += ch;
    }
    cols.push(cur.trim());
    const row = {};
    headers.forEach((h, idx) => row[h] = (cols[idx] || '').replace(/"/g, '').trim());
    rows.push(row);
  }
  return rows;
}

function parseDOB(str) {
  if (!str) return null;
  // Format: DD-MM-YYYY
  const parts = str.split('-');
  if (parts.length === 3) {
    return `${parts[2]}-${parts[1].padStart(2,'0')}-${parts[0].padStart(2,'0')}`;
  }
  return null;
}

async function migrate() {
  console.log('📥 Fetching CSV from Google Sheets...');
  const csv = await fetchCSV(SHEET_URL);
  const rows = parseCSV(csv);
  console.log(`✅ Parsed ${rows.length} members`);

  const client = await pool.connect();
  let inserted = 0, skipped = 0, errors = 0;

  try {
    // Process in batches of 100
    const batchSize = 100;
    for (let i = 0; i < rows.length; i += batchSize) {
      const batch = rows.slice(i, i + batchSize);
      for (const r of batch) {
        if (!r['Email'] || !r['User ID']) { skipped++; continue; }
        const email = r['Email'].toLowerCase().trim();
        if (!email || !email.includes('@')) { skipped++; continue; }

        // Map member_number: #00007182 → ATP-07182
        const rawId = r['User ID'].replace('#', '').replace('000', '');
        const memberNum = `ATP-${rawId.padStart(5, '0')}`;

        const dob = parseDOB(r['Date of Birth']);
        const gender = r['Gender'] ? r['Gender'].toLowerCase() : null;
        const status = r['Status'] === 'Active';
        const interests = r['Favourite Sports and Interests'] || null;
        const sports = interests ? interests.split(',').map(s => s.trim()).filter(Boolean) : [];

        try {
          await client.query(
            `INSERT INTO members (
              member_number, first_name, last_name, email,
              gender, nationality, date_of_birth,
              points_balance, padel_level, sports_preferences,
              email_verified, joined_at
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NOW())
            ON CONFLICT (email) DO UPDATE SET
              member_number = EXCLUDED.member_number,
              first_name = EXCLUDED.first_name,
              last_name = EXCLUDED.last_name,
              nationality = EXCLUDED.nationality,
              gender = EXCLUDED.gender,
              date_of_birth = EXCLUDED.date_of_birth,
              points_balance = EXCLUDED.points_balance,
              padel_level = EXCLUDED.padel_level,
              sports_preferences = EXCLUDED.sports_preferences`,
            [
              memberNum,
              r['First Name'] || '',
              r['Last Name'] || '',
              email,
              gender,
              r['Nationality'] || null,
              dob,
              parseInt(r['Points']) || 0,
              r['Padel Level'] || null,
              JSON.stringify(sports),
              true
            ]
          );
          inserted++;
        } catch (err) {
          errors++;
          if (errors <= 5) console.log(`  ⚠️  Row error (${email}): ${err.message}`);
        }
      }
      process.stdout.write(`\r  Progress: ${Math.min(i + batchSize, rows.length)}/${rows.length} (${inserted} inserted, ${skipped} skipped, ${errors} errors)`);
    }
  } finally {
    client.release();
  }

  console.log(`\n\n✅ Migration complete!`);
  console.log(`   Inserted/updated: ${inserted}`);
  console.log(`   Skipped:          ${skipped}`);
  console.log(`   Errors:           ${errors}`);
  await pool.end();
}

migrate().catch(err => { console.error('Fatal:', err); process.exit(1); });
