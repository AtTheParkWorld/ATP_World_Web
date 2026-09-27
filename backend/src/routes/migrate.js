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
  // Robust CSV parser that handles quoted fields with commas and newlines
  const rows = [];
  const headers = [];
  let field = '', inQuote = false, isHeader = true;
  const currentRow = [];

  const flush = () => {
    const val = field.replace(/^"|"$/g, '').trim();
    field = '';
    if (isHeader) { headers.push(val); }
    else { currentRow.push(val); }
  };

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];
    if (ch === '"') {
      if (inQuote && next === '"') { field += '"'; i++; }
      else { inQuote = !inQuote; }
    } else if (ch === ',' && !inQuote) {
      flush();
    } else if ((ch === '\n' || (ch === '\r' && next === '\n')) && !inQuote) {
      if (ch === '\r') i++;
      flush();
      if (isHeader) { isHeader = false; }
      else if (currentRow.length > 1) {
        const row = {};
        headers.forEach((h, idx) => { row[h] = currentRow[idx] || ''; });
        rows.push(row);
      }
      currentRow.length = 0;
    } else {
      field += ch;
    }
  }
  // Handle last field/row
  if (field || currentRow.length) {
    flush();
    if (!isHeader && currentRow.length > 1) {
      const row = {};
      headers.forEach((h, idx) => { row[h] = currentRow[idx] || ''; });
      rows.push(row);
    }
  }
  return rows;
}


/* ── Legacy → new-system mapping ────────────────────────────────
 *
 * The legacy site and this one describe padel levels differently.
 * Legacy writes the sign BEFORE the letter ("LEVEL +D"); we write it
 * after ("Level D+"). A raw copy therefore produces a level string that
 * can never match a court's allowed levels, which silently breaks
 * level-restricted padel booking — so every value is mapped explicitly.
 *
 * Legacy also carries three grades this system has no slot for
 * (LEVEL -D, LEVEL D, LEVEL C, ~330 members). Founder's call on
 * 2026-09-27: leave those blank rather than guess a level for someone.
 * They pick their own level in the app before booking.
 */
const PADEL_LEVEL_MAP = {
  'BEGINNER': 'Beginner',
  'LEVEL +D': 'Level D+',
  'LEVEL -C': 'Level C-',
  'LEVEL +C': 'Level C+',
  // Deliberately unmapped → null: 'LEVEL -D', 'LEVEL D', 'LEVEL C'
};

const GENDER_MAP = { 'female': 'female', 'male': 'male', 'other': 'other' };

const VALID_TOP_SIZES = ['XS', 'S', 'M', 'L', 'XL', '2XL', '3XL'];

/** Legacy DOB is DD-MM-YYYY (verified: 4,358 rows have a day > 12, none
 *  have a month > 12). Returns YYYY-MM-DD or null. */
function parseDOB(str) {
  if (!str) return null;
  const m = String(str).trim().match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
  if (!m) return null;
  const [, d, mo, y] = m;
  const day = +d, mon = +mo, year = +y;
  if (mon < 1 || mon > 12 || day < 1 || day > 31) return null;
  if (year < 1900 || year > new Date().getFullYear()) return null;
  return `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`;
}

/** Re-case a name the member typed in full caps ("TATIANA" -> "Tatiana").
 *
 *  Only ever touches a value that is ENTIRELY uppercase, so a name the
 *  member capitalised deliberately (McDonald, O'Brien) is never altered.
 *
 *  Short all-caps values in this export are overwhelmingly initials
 *  ("AJ", "J R", "JD") or company suffixes ("FZE", "BHD", "RKB"), and
 *  title-casing those makes them worse, so:
 *    - 2 letters or fewer      -> left alone
 *    - 3 letters with no vowel -> left alone (acronym, e.g. BHD/RKB/SBK)
 *    - dotted initials (R.I.M.T) -> left alone
 *  That keeps ALI/JOY/KIM/LIU/MAY/NIN/VIA/XUE correct while leaving the
 *  initials intact.
 */
/** Business suffixes that turn up in the legacy name fields and would
 *  otherwise pass the vowel test above (FZE = UAE Free Zone Establishment). */
const NAME_ACRONYMS = new Set(['FZE', 'FZC', 'FZCO', 'LLC', 'DMCC', 'BHD', 'PJSC']);

function fixAllCaps(s) {
  if (!s || s !== s.toUpperCase()) return s;          // mixed case: member's own choice
  if (NAME_ACRONYMS.has(s.replace(/[^A-Za-z]/g, ''))) return s;
  if (/^(?:[A-Z]\.)+[A-Z]?\.?$/.test(s)) return s;    // R.I.M.T
  const letters = s.replace(/[^A-Za-z]/g, '');
  if (letters.length <= 2) return s;
  if (letters.length === 3 && !/[AEIOUY]/.test(letters)) return s;
  // Title-case each word; hyphens and apostrophes start a new word too,
  // so FOULKES-WILLIAMS -> Foulkes-Williams.
  return s.toLowerCase().replace(/(^|[\s\-'])([a-z])/g, (_, sep, c) => sep + c.toUpperCase());
}

/** Trim, collapse runs of whitespace, drop the trailing full stop the
 *  legacy signup form left on some names ("TATIANA."), and re-case
 *  shouted names. */
function cleanName(v) {
  const s = String(v == null ? '' : v)
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\.+$/, '')
    .trim();
  return fixAllCaps(s);
}

function mapRow(r) {
  const email = String(r['Email'] || '').toLowerCase().trim();
  const rawId = String(r['User ID'] || '').trim();
  if (!email || !email.includes('@') || !rawId) return null;

  const first = cleanName(r['First Name']);
  const last  = cleanName(r['Last Name']);
  if (!first && !last) return null;

  const g = String(r['Gender'] || '').toLowerCase().trim();
  const size = String(r['Top Size'] || '').toUpperCase().trim();
  const lvl = String(r['Padel Level'] || '').toUpperCase().trim();

  return {
    email,
    member_number: `ATP-${rawId.replace(/^#0+/, '').padStart(5, '0')}`,
    first_name: first || last,
    last_name:  last  || '',
    gender:      GENDER_MAP[g] || null,
    nationality: String(r['Nationality'] || '').trim() || null,
    date_of_birth: parseDOB(r['Date of Birth']),
    top_size:    VALID_TOP_SIZES.includes(size) ? size : null,
    padel_level: PADEL_LEVEL_MAP[lvl] || null,
    sports: String(r['Favourite Sports and Interests'] || '')
      .split(',').map(s => s.trim()).filter(Boolean),
    // points deliberately NOT carried over — founder's call 2026-09-27:
    // everyone starts from 0 on the new system.
    _unmappedLevel: lvl && !PADEL_LEVEL_MAP[lvl] ? lvl : null,
  };
}

// POST /api/migrate/members  (admin setup only)
// Body: { setupKey, sheetId?, dryRun? }
//   dryRun: true  → parse, map and report what WOULD change. Writes nothing.
router.post('/members', async (req, res, next) => {
  try {
    const { setupKey, sheetId, dryRun } = req.body;
    if (setupKey !== process.env.ADMIN_SETUP_KEY) return res.status(401).json({ error: 'Unauthorized' });
    if (!sheetId) return res.status(400).json({ error: 'sheetId required' });

    const url = `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv`;
    const csv = await fetchURL(url);
    const rows = parseCSV(csv);

    const mapped = [], skipped = [];
    for (const r of rows) {
      const m = mapRow(r);
      if (m) mapped.push(m); else skipped.push(r['Email'] || '(no email)');
    }

    // Report fill rates + level mapping so a dry run is genuinely informative.
    const stats = {
      rowsInSheet: rows.length,
      usable: mapped.length,
      skipped: skipped.length,
      withGender: mapped.filter(m => m.gender).length,
      withNationality: mapped.filter(m => m.nationality).length,
      withDOB: mapped.filter(m => m.date_of_birth).length,
      withTopSize: mapped.filter(m => m.top_size).length,
      withPadelLevel: mapped.filter(m => m.padel_level).length,
      withSports: mapped.filter(m => m.sports.length).length,
      levelLeftBlank: mapped.filter(m => m._unmappedLevel).length,
    };

    // Which of these already exist? Tells us insert-vs-update up front.
    const emails = mapped.map(m => m.email);
    const { rows: existing } = await query(
      `SELECT email FROM members WHERE email = ANY($1::text[])`, [emails]
    );
    const have = new Set(existing.map(e => e.email));
    stats.wouldInsert = mapped.filter(m => !have.has(m.email)).length;
    stats.wouldUpdate = mapped.filter(m =>  have.has(m.email)).length;

    if (dryRun) {
      return res.json({ dryRun: true, stats, note: 'Nothing was written.' });
    }

    let inserted = 0, updated = 0, errors = 0;
    const errorSamples = [];

    for (const m of mapped) {
      const isNew = !have.has(m.email);
      try {
        await query(
          `INSERT INTO members (
             member_number, first_name, last_name, email,
             gender, nationality, date_of_birth, top_size,
             padel_level, sports_preferences,
             email_verified, migrated_from_csv, joined_at
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,true,true,NOW())
           ON CONFLICT (email) DO UPDATE SET
             -- member_number is NOT updated: an existing member may already
             -- hold a number issued by this system, and overwriting it can
             -- collide with another member's unique number.
             first_name  = EXCLUDED.first_name,
             last_name   = EXCLUDED.last_name,
             -- COALESCE everywhere else: the legacy sheet fills blanks, it
             -- never erases something the member has set here.
             gender        = COALESCE(EXCLUDED.gender,        members.gender),
             nationality   = COALESCE(EXCLUDED.nationality,   members.nationality),
             date_of_birth = COALESCE(EXCLUDED.date_of_birth, members.date_of_birth),
             top_size      = COALESCE(EXCLUDED.top_size,      members.top_size),
             padel_level   = COALESCE(EXCLUDED.padel_level,   members.padel_level),
             sports_preferences = CASE
               WHEN jsonb_array_length(EXCLUDED.sports_preferences) > 0
                 THEN EXCLUDED.sports_preferences
               ELSE members.sports_preferences END,
             migrated_from_csv = true,
             updated_at = NOW()`,
          [
            m.member_number, m.first_name, m.last_name, m.email,
            m.gender, m.nationality, m.date_of_birth, m.top_size,
            m.padel_level, JSON.stringify(m.sports),
          ]
        );
        if (isNew) inserted++; else updated++;
      } catch (err) {
        errors++;
        if (errorSamples.length < 5) errorSamples.push(`${m.email}: ${err.message}`);
      }
    }

    res.json({ success: true, stats, inserted, updated, errors, errorSamples });
  } catch (err) { next(err); }
});

module.exports = router;
