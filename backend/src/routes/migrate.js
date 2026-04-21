const express = require('express');
const router = express.Router();
const https = require('https');
const { query } = require('../db');

function fetchURL(url, redirectCount = 0) {
  return new Promise((resolve, reject) => {
    if (redirectCount > 5) return reject(new Error('Too many redirects'));
    https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
      if ([301,302,303,307,308].includes(res.statusCode) && res.headers.location) {
        return fetchURL(res.headers.location, redirectCount + 1).then(resolve).catch(reject);
      }
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve(data));
      res.on('error', reject);
    }).on('error', reject);
  });
}

function parseCSV(text) {
  const lines = text.split('\n');
  const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const cols = [];
    let cur = '', inQ = false;
    for (const ch of lines[i]) {
      if (ch === '"') { inQ = !inQ; }
      else if (ch === ',' && !inQ) { cols.push(cur.trim()); cur = ''; }
      else cur += ch;
    }
    cols.push(cur.trim());
    const row = {};
    headers.forEach((h, idx) => { row[h] = (cols[idx] || '').replace(/^"|"$/g, '').trim(); });
    rows.push(row);
  }
  return rows;
}

function parseDOB(str) {
  if (!str) return null;
  const p = str.split('-');
  if (p.length === 3 && p[2].length === 4) return `${p[2]}-${p[1].padStart(2,'0')}-${p[0].padStart(2,'0')}`;
  return null;
}

// POST /api/migrate/members  (admin setup only)
router.post('/members', async (req, res, next) => {
  try {
    const { setupKey, sheetId } = req.body;
    if (setupKey !== process.env.ADMIN_SETUP_KEY) return res.status(401).json({ error: 'Unauthorized' });

    const id = sheetId || '1yalnFyBcT3f596VDEFlL1cCoxBVEOXpm7JLPUykQNDo';
    const url = `https://docs.google.com/spreadsheets/d/${id}/export?format=csv`;

    console.log('Migration: fetching CSV...');
    const csv = await fetchURL(url);
    const rows = parseCSV(csv);
    console.log(`Migration: parsed ${rows.length} rows`);

    let inserted = 0, skipped = 0, errors = 0;

    for (const r of rows) {
      const email = (r['Email'] || '').toLowerCase().trim();
      if (!email || !email.includes('@') || !r['User ID']) { skipped++; continue; }

      const rawId = r['User ID'].replace(/^#0+/, '');
      const memberNum = `ATP-${rawId.padStart(5, '0')}`;
      const dob = parseDOB(r['Date of Birth']);
      const gender = r['Gender'] ? r['Gender'].toLowerCase() : null;
      const sports = (r['Favourite Sports and Interests'] || '')
        .split(',').map(s => s.trim()).filter(Boolean);

      try {
        await query(
          `INSERT INTO members (
            member_number, first_name, last_name, email,
            gender, nationality, date_of_birth,
            points_balance, padel_level, sports_preferences,
            email_verified, joined_at
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,true,NOW())
          ON CONFLICT (email) DO UPDATE SET
            member_number = EXCLUDED.member_number,
            first_name    = EXCLUDED.first_name,
            last_name     = EXCLUDED.last_name,
            nationality   = EXCLUDED.nationality,
            gender        = EXCLUDED.gender,
            date_of_birth = EXCLUDED.date_of_birth,
            points_balance = EXCLUDED.points_balance,
            padel_level   = EXCLUDED.padel_level,
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
            JSON.stringify(sports)
          ]
        );
        inserted++;
      } catch (err) {
        errors++;
        if (errors <= 3) console.log(`  Row error (${email}): ${err.message}`);
      }
    }

    console.log(`Migration done: ${inserted} inserted, ${skipped} skipped, ${errors} errors`);
    res.json({ success: true, total: rows.length, inserted, skipped, errors });
  } catch (err) { next(err); }
});

module.exports = router;
