/**
 * ATP Member Migration Script
 * Usage: node src/db/import-members.js --file /path/to/members.csv
 *
 * Expected CSV columns (any order, case-insensitive):
 *   first_name, last_name, email, points, nationality,
 *   sports_preferences, member_since, date_of_birth
 *
 * Run AFTER migrate.js has been executed.
 */

const fs    = require('fs');
const path  = require('path');
const { v4: uuidv4 } = require('uuid');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });

const { pool, query, transaction } = require('./index');
const emailService = require('../services/email');

// ── PARSE CSV ─────────────────────────────────────────────────
function parseCSV(filePath) {
  const raw  = fs.readFileSync(filePath, 'utf8');
  const lines = raw.split('\n').filter(Boolean);
  const headers = lines[0].split(',').map(h => h.trim().toLowerCase()
    .replace(/[^a-z_]/g, '_').replace(/__+/g, '_'));

  return lines.slice(1).map(line => {
    // Handle quoted fields
    const values = [];
    let current = '', inQuotes = false;
    for (const char of line) {
      if (char === '"') { inQuotes = !inQuotes; }
      else if (char === ',' && !inQuotes) { values.push(current.trim()); current = ''; }
      else { current += char; }
    }
    values.push(current.trim());

    const row = {};
    headers.forEach((h, i) => { row[h] = values[i] || ''; });
    return row;
  }).filter(r => r.email);
}

// ── NORMALISE ROW ─────────────────────────────────────────────
function normaliseRow(row, index) {
  // Map common column name variants
  const email      = (row.email || row.email_address || '').toLowerCase().trim();
  const firstName  = row.first_name || row.firstname || row.given_name || '';
  const lastName   = row.last_name  || row.lastname  || row.family_name || row.surname || '';
  const points     = parseInt(row.points || row.atp_points || 0) || 0;
  const nationality = row.nationality || row.country || '';
  const memberSince = row.member_since || row.joined_at || row.joined || row.created_at || null;
  const dob        = row.date_of_birth || row.dob || row.birthday || null;

  // Sports preferences — handle comma-separated in a cell
  let sports = [];
  const rawSports = row.sports_preferences || row.sports || row.interests || '';
  if (rawSports) {
    sports = rawSports.split(/[;|\/]/).map(s => s.trim()).filter(Boolean);
  }

  return { email, firstName, lastName, points, nationality, memberSince, dob, sports, index };
}

// ── IMPORT ────────────────────────────────────────────────────
async function importMembers(filePath, options = {}) {
  const { dryRun = false, sendEmails = false, batchSize = 100 } = options;

  console.log(`\n🌿 ATP Member Migration`);
  console.log(`   File:      ${filePath}`);
  console.log(`   Dry run:   ${dryRun}`);
  console.log(`   Send emails: ${sendEmails}`);
  console.log('');

  const rows = parseCSV(filePath);
  console.log(`📊 Found ${rows.length} rows in CSV\n`);

  const results = {
    total:    rows.length,
    imported: 0,
    skipped:  0,
    errors:   [],
  };

  // Get existing emails to skip
  const { rows: existing } = await query('SELECT LOWER(email) AS email FROM members');
  const existingEmails = new Set(existing.map(r => r.email));

  // Process in batches
  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize).map((r, j) => normaliseRow(r, i + j + 1));
    process.stdout.write(`Processing rows ${i+1}–${Math.min(i+batchSize, rows.length)}... `);

    for (const m of batch) {
      if (!m.email || !m.email.includes('@')) {
        results.errors.push({ row: m.index, reason: 'Invalid email', data: m.email });
        continue;
      }
      if (existingEmails.has(m.email)) {
        results.skipped++;
        continue;
      }

      if (dryRun) {
        results.imported++;
        existingEmails.add(m.email);
        continue;
      }

      try {
        const id           = uuidv4();
        const memberNumber = `ATP-${String(results.imported + results.skipped + 1).padStart(5,'0')}`;
        let parsedDob      = null;
        if (m.dob) {
          const d = new Date(m.dob);
          if (!isNaN(d.getTime())) parsedDob = d.toISOString().split('T')[0];
        }
        let parsedJoined = new Date();
        if (m.memberSince) {
          const d = new Date(m.memberSince);
          if (!isNaN(d.getTime())) parsedJoined = d;
        }

        await query(
          `INSERT INTO members
            (id, member_number, first_name, last_name, email, points_balance,
             nationality, date_of_birth, sports_preferences, joined_at,
             email_verified, migrated_from_csv)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,true,true)`,
          [
            id, memberNumber,
            m.firstName || 'Member', m.lastName,
            m.email, m.points,
            m.nationality || null, parsedDob,
            JSON.stringify(m.sports),
            parsedJoined,
          ]
        );

        // Seed points ledger if they have a balance
        if (m.points > 0) {
          await query(
            `INSERT INTO points_ledger
              (member_id, amount, balance, reason, description, expires_at)
             VALUES ($1,$2,$3,'migration','Migrated points balance from previous system', $4)`,
            [id, m.points, m.points, new Date(Date.now() + 365 * 24 * 60 * 60 * 1000)]
          );
        }

        existingEmails.add(m.email);
        results.imported++;

        // Send claim email
        if (sendEmails) {
          const crypto = require('crypto');
          const rawToken = crypto.randomBytes(32).toString('hex');
          const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
          const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000); // 48 hours

          await query(
            `INSERT INTO auth_tokens (member_id, token_hash, type, expires_at)
             VALUES ($1,$2,'magic_link',$3)`,
            [id, tokenHash, expiresAt]
          );

          const magicUrl = `${process.env.FRONTEND_URL}/auth/verify?token=${rawToken}&email=${encodeURIComponent(m.email)}`;
          await emailService.sendMigrationClaim(
            { first_name: m.firstName, email: m.email, points_balance: m.points },
            magicUrl
          );
        }
      } catch (err) {
        results.errors.push({ row: m.index, email: m.email, reason: err.message });
      }
    }
    console.log('✓');
  }

  // Print summary
  console.log('\n' + '='.repeat(50));
  console.log('MIGRATION SUMMARY');
  console.log('='.repeat(50));
  console.log(`✅ Imported:  ${results.imported}`);
  console.log(`⏭️  Skipped:   ${results.skipped} (already exist)`);
  console.log(`❌ Errors:    ${results.errors.length}`);
  if (results.errors.length) {
    console.log('\nErrors:');
    results.errors.slice(0, 20).forEach(e => {
      console.log(`  Row ${e.row}: ${e.email || 'no email'} — ${e.reason}`);
    });
    if (results.errors.length > 20) console.log(`  ... and ${results.errors.length - 20} more`);
  }
  console.log('\n✅ Migration complete!');
  if (dryRun) console.log('   (Dry run — no data was written)');
  if (sendEmails) console.log('   Claim emails sent to new members');

  return results;
}

// ── CLI ───────────────────────────────────────────────────────
if (require.main === module) {
  const args   = process.argv.slice(2);
  const fileIdx = args.indexOf('--file');
  const filePath = fileIdx >= 0 ? args[fileIdx + 1] : null;
  const dryRun   = args.includes('--dry-run');
  const sendEmails = args.includes('--send-emails');

  if (!filePath || !fs.existsSync(filePath)) {
    console.error('Usage: node import-members.js --file /path/to/members.csv [--dry-run] [--send-emails]');
    process.exit(1);
  }

  importMembers(filePath, { dryRun, sendEmails })
    .then(() => pool.end())
    .catch(err => { console.error(err); process.exit(1); });
}

module.exports = { importMembers };
