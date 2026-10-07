/**
 * Reset every member's points to 0 (founder 2026-10-07: "bring everyone
 * to 0" — the balances were migrated from the previous app, and nobody
 * has earned real points on the new one yet).
 *
 * One transaction:
 *   1. every non-zero balance is copied to points_reset_backup (run_id),
 *      so the reset can be undone exactly;
 *   2. each of those members gets a ledger row taking the balance to 0
 *      (reason 'admin_reset'), so their Rewards history explains it;
 *   3. every earning row from before the reset is closed (remaining=0,
 *      expired_at=NOW()), so the expiry job can never deduct those old
 *      points again from points earned later, and no "your points are
 *      expiring" email goes out for points members no longer have;
 *   4. balances are set to 0;
 *   5. system_config.points_reset_at records the moment, and the
 *      leaderboard only counts points earned after it (fresh start for
 *      "All time" too).
 */
const crypto = require('crypto');
const { query, transaction } = require('../db');

const RESET_KEY = 'points_reset_at';
const RESET_REASON = 'admin_reset';
const RESET_NOTE = 'Points reset to 0: a fresh start on the new ATP app';
const UNDO_REASON = 'admin_reset_undo';

let _cutoffCache = { at: 0, value: null };

/** When points were last reset (Date), or null. Cached for 60s. */
async function getResetCutoff() {
  if (Date.now() - _cutoffCache.at < 60000) return _cutoffCache.value;
  let value = null;
  try {
    const { rows } = await query(`SELECT value FROM system_config WHERE key=$1`, [RESET_KEY]);
    const raw = rows.length ? rows[0].value : null;
    const d = raw ? new Date(typeof raw === 'string' ? raw : String(raw)) : null;
    value = d && !isNaN(d.getTime()) ? d : null;
  } catch (e) {
    if (e.code !== '42P01') throw e;
  }
  _cutoffCache = { at: Date.now(), value };
  return value;
}

/** What a reset would touch. Read-only. */
async function previewReset() {
  const { rows } = await query(
    `SELECT COUNT(*) FILTER (WHERE points_balance <> 0)::int AS members_with_points,
            COALESCE(SUM(points_balance) FILTER (WHERE points_balance > 0), 0)::bigint AS total_points,
            COUNT(*) FILTER (WHERE points_balance < 0)::int AS members_negative,
            COUNT(*)::int AS members_total
       FROM members`
  );
  return {
    members_total: rows[0].members_total,
    members_with_points: rows[0].members_with_points,
    total_points: Number(rows[0].total_points),
    members_negative: rows[0].members_negative,
    last_reset_at: await getResetCutoff(),
  };
}

async function _ensureBackupTable() {
  await query(
    `CREATE TABLE IF NOT EXISTS points_reset_backup (
       run_id         UUID        NOT NULL,
       member_id      UUID        NOT NULL REFERENCES members(id) ON DELETE CASCADE,
       balance_before INTEGER     NOT NULL,
       created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
       undone_at      TIMESTAMPTZ,
       PRIMARY KEY (run_id, member_id)
     )`
  );
}

/** Set every balance to 0. Returns { run_id, members_reset, points_removed, reset_at }. */
async function resetAllPoints({ adminId = null } = {}) {
  await _ensureBackupTable();
  const runId = crypto.randomUUID();
  const result = await transaction(async (client) => {
    const { rows: stamp } = await client.query('SELECT NOW() AS now');
    const resetAt = stamp[0].now;

    const { rowCount: membersReset } = await client.query(
      `INSERT INTO points_reset_backup (run_id, member_id, balance_before)
       SELECT $1, id, points_balance FROM members WHERE points_balance <> 0`,
      [runId]
    );
    const { rows: sum } = await client.query(
      `SELECT COALESCE(SUM(balance_before), 0)::bigint AS total
         FROM points_reset_backup WHERE run_id = $1`,
      [runId]
    );

    await client.query(
      `INSERT INTO points_ledger (member_id, amount, balance, reason, description, created_by)
       SELECT member_id, -balance_before, 0, $2, $3, $4
         FROM points_reset_backup WHERE run_id = $1`,
      [runId, RESET_REASON, RESET_NOTE, adminId]
    );

    // Close every earning row from before the reset (see header, 3).
    try {
      await client.query(
        `UPDATE points_ledger SET remaining = 0, expired_at = $1
          WHERE amount > 0 AND expired_at IS NULL AND created_at <= $1`,
        [resetAt]
      );
    } catch (e) {
      if (e.code !== '42703') throw e;
      await client.query(
        `UPDATE points_ledger SET expired_at = $1
          WHERE amount > 0 AND expired_at IS NULL AND created_at <= $1`,
        [resetAt]
      );
    }

    await client.query(
      `UPDATE members SET points_balance = 0, updated_at = NOW() WHERE points_balance <> 0`
    );

    await client.query(
      `INSERT INTO system_config (key, value, label, description, updated_at, updated_by)
       VALUES ($1, to_jsonb($2::text), 'Points reset at',
               'Leaderboards only count points earned after this moment.', NOW(), $3)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW(),
                                       updated_by = EXCLUDED.updated_by`,
      [RESET_KEY, new Date(resetAt).toISOString(), adminId]
    );

    return {
      run_id: runId,
      members_reset: membersReset,
      points_removed: Number(sum[0].total),
      reset_at: new Date(resetAt).toISOString(),
    };
  });
  _cutoffCache = { at: 0, value: null };
  return result;
}

/**
 * Undo a reset run: give each member back exactly what the run took,
 * on top of whatever they have now. Old earning rows stay closed (the
 * points come back as one 'admin_reset_undo' row instead), and the
 * leaderboard cutoff is cleared.
 */
async function undoReset(runId, { adminId = null } = {}) {
  await _ensureBackupTable();
  const result = await transaction(async (client) => {
    const { rows } = await client.query(
      `SELECT member_id, balance_before FROM points_reset_backup
        WHERE run_id = $1 AND undone_at IS NULL FOR UPDATE`,
      [runId]
    );
    let restored = 0;
    for (const r of rows) {
      const { rows: m } = await client.query(
        'SELECT points_balance FROM members WHERE id=$1 FOR UPDATE', [r.member_id]
      );
      if (!m.length) continue;
      const newBal = m[0].points_balance + r.balance_before;
      try {
        await client.query(
          `INSERT INTO points_ledger (member_id, amount, balance, reason, description, created_by, remaining)
           VALUES ($1, $2, $3, $4, 'Points reset undone', $5, $2)`,
          [r.member_id, r.balance_before, newBal, UNDO_REASON, adminId]
        );
      } catch (e) {
        if (e.code !== '42703') throw e;
        await client.query(
          `INSERT INTO points_ledger (member_id, amount, balance, reason, description, created_by)
           VALUES ($1, $2, $3, $4, 'Points reset undone', $5)`,
          [r.member_id, r.balance_before, newBal, UNDO_REASON, adminId]
        );
      }
      await client.query(
        'UPDATE members SET points_balance=$1, updated_at=NOW() WHERE id=$2',
        [newBal, r.member_id]
      );
      restored += r.balance_before;
    }
    await client.query(
      'UPDATE points_reset_backup SET undone_at = NOW() WHERE run_id = $1 AND undone_at IS NULL',
      [runId]
    );
    await client.query('DELETE FROM system_config WHERE key = $1', [RESET_KEY]);
    return { run_id: runId, members_restored: rows.length, points_restored: restored };
  });
  _cutoffCache = { at: 0, value: null };
  return result;
}

module.exports = { getResetCutoff, previewReset, resetAllPoints, undoReset, RESET_REASON };
