/**
 * GET /api/admin/members (+ /:id) — the admin Members tab.
 *
 * Founder 2026-10-06: "I can't see all 8046 members". No real DB:
 * pool.query is stubbed, and the tests pin the SQL + params the list
 * sends — paging, search across every member, status filters, the
 * pre-migration 42703 fallback, the CSV, and that no password hash
 * ever leaves the detail endpoint.
 */
// describe / it / expect / vi are injected as globals by Vitest.
const request = require('supertest');
const jwt = require('jsonwebtoken');
const db = require('../src/db');
const app = require('../src/server');

const ADMIN_ID  = 'aaaaaaaa-0000-4000-8000-000000000001';
const MEMBER_ID = 'bbbbbbbb-0000-4000-8000-000000000002';
const token = (sub = ADMIN_ID) => jwt.sign({ sub }, process.env.JWT_SECRET, { expiresIn: '1h' });

function listRow(over = {}) {
  return {
    id: MEMBER_ID, member_number: 'ATP-00042', first_name: 'Sara', last_name: 'Khan',
    email: 'sara@example.com', phone: '+971501234567', subscription_type: 'premium',
    points_balance: 120, is_ambassador: false, is_coach: false, is_admin: false,
    account_status: 'active', sessions_count: 7, bookings_count: 9, tribe_name: 'Runners',
    city_name: 'Dubai', auth_providers: ['google'], joined_at: '2025-01-02T00:00:00Z',
    ...over,
  };
}

/** Fake pool. `opts.fail42703` makes the first full list query throw a
 *  pre-migration "column does not exist"; `opts.admin=false` makes the
 *  caller a plain member; `opts.detail` is the to_jsonb(m) row. */
function stubDb(opts = {}) {
  const calls = [];
  let failed = false;
  const fakeQuery = async (text, params = []) => {
    const sql = String(text);
    calls.push({ sql, params });
    if (/SELECT id, first_name, last_name, email, is_admin/.test(sql)) {
      return { rows: [{ id: params[0], first_name: 'Ad', last_name: 'Min', email: 'a@x.io',
                        is_admin: opts.admin !== false, is_ambassador: false, is_coach: false, is_banned: false }] };
    }
    if (/to_jsonb\(m\)/.test(sql)) {
      return { rows: opts.detail === null ? [] : [{
        member: { id: MEMBER_ID, first_name: 'Sara', last_name: 'Khan', email: 'sara@example.com',
                  is_banned: false, pending_deletion_at: null, reset_token: 'leak-me', totp_secret: 'leak-me',
                  city_id: null, tribe_id: null, ...(opts.detail || {}) },
        has_password: true, is_deleted: false,
      }] };
    }
    if (/FROM members m\s+LEFT JOIN cities/.test(sql) && /ORDER BY/.test(sql)) {
      if (opts.fail42703 && !failed && /LEFT JOIN tribes/.test(sql)) {
        failed = true;
        const e = new Error('column m.tribe_id does not exist'); e.code = '42703'; throw e;
      }
      return { rows: opts.rows || [listRow()] };
    }
    if (/SELECT COUNT\(\*\) AS total FROM members m/.test(sql)) return { rows: [{ total: String(opts.total ?? 8046) }] };
    if (/AS "all"/.test(sql)) return { rows: [{ all: 8046, active: 8040, banned: 1, pending_deletion: 4, deleted: 1 }] };
    if (/FROM bookings b JOIN sessions s/.test(sql) && /COUNT\(\*\)/.test(sql)) {
      return { rows: [{ bookings: 9, attended: 7, no_show: 1, cancelled: 1, upcoming: 0 }] };
    }
    if (/FROM push_tokens/.test(sql)) return { rows: [{ platform: 'ios', devices: 1, last_seen_at: '2026-10-01T00:00:00Z' }] };
    return { rows: [] };
  };
  vi.spyOn(db.pool, 'query').mockImplementation(fakeQuery);
  const listCalls = () => calls.filter((c) => /FROM members m\s+LEFT JOIN cities/.test(c.sql) && /ORDER BY/.test(c.sql));
  return { calls, listCalls };
}

const get = (url, sub) => request(app).get(url).set('Authorization', 'Bearer ' + token(sub));

afterEach(() => { vi.restoreAllMocks(); });

describe('GET /api/admin/members — every member reachable', () => {
  it('pages with limit/offset and reports the true total', async () => {
    const db_ = stubDb();
    const res = await get('/api/admin/members?status=all&limit=100&offset=8000');
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(8046);
    expect(res.body).toMatchObject({ limit: 100, offset: 8000, sort: 'joined', dir: 'desc' });
    expect(res.body.status_counts.all).toBe(8046);
    const [list] = db_.listCalls();
    expect(list.sql).toMatch(/LIMIT \$\d+ OFFSET \$\d+$/);
    expect(list.params.slice(-2)).toEqual([100, 8000]);
    // status=all → no banned / deleted filter at all
    expect(list.sql).not.toMatch(/is_banned=false/);
    expect(list.sql).not.toMatch(/password_hash,|m\.password_hash AS/);
  });

  it('accepts ?page= and clamps limit to 500', async () => {
    const db_ = stubDb();
    await get('/api/admin/members?status=all&page=3&limit=100');
    expect(db_.listCalls()[0].params.slice(-2)).toEqual([100, 200]);
    await get('/api/admin/members?status=all&limit=100000');
    expect(db_.listCalls()[1].params.slice(-2)).toEqual([500, 0]);
  });

  it('keeps the legacy non-banned default when no status is sent', async () => {
    const db_ = stubDb();
    await get('/api/admin/members?is_ambassador=true&limit=200');
    const [list] = db_.listCalls();
    expect(list.sql).toMatch(/m\.is_banned=false AND m\.is_ambassador=true/);
  });

  it('filters by account status', async () => {
    const db_ = stubDb();
    await get('/api/admin/members?status=pending_deletion');
    expect(db_.listCalls()[0].sql).toMatch(/m\.pending_deletion_at IS NOT NULL/);
    await get('/api/admin/members?status=deleted');
    expect(db_.listCalls()[1].sql).toMatch(/m\.password_hash = 'ACCOUNT_DELETED'/);
  });

  it('searches full name, email, phone and member number', async () => {
    const db_ = stubDb();
    await get('/api/admin/members?status=all&search=' + encodeURIComponent('Sara Khan'));
    let list = db_.listCalls()[0];
    expect(list.sql).toMatch(/\(m\.first_name \|\| ' ' \|\| m\.last_name\) ILIKE \$1/);
    expect(list.sql).toMatch(/m\.phone ILIKE \$1/);
    expect(list.sql).toMatch(/m\.member_number ILIKE \$1/);
    expect(list.params[0]).toBe('%Sara Khan%');

    await get('/api/admin/members?status=all&search=' + encodeURIComponent('050 123 4567'));
    list = db_.listCalls()[1];
    expect(list.sql).toMatch(/regexp_replace\(COALESCE\(m\.phone, ''\), '\\D', '', 'g'\) LIKE \$2/);
    expect(list.params[1]).toBe('%501234567%');

    await get('/api/admin/members?status=all&search=' + encodeURIComponent('john_doe%'));
    expect(db_.listCalls()[2].params[0]).toBe('%john\\_doe\\%%');
  });

  it('sorts by a whitelisted key only', async () => {
    const db_ = stubDb();
    await get('/api/admin/members?status=all&sort=sessions&dir=asc');
    expect(db_.listCalls()[0].sql).toMatch(/ORDER BY sessions_count ASC NULLS LAST, m\.id/);
    await get('/api/admin/members?status=all&sort=' + encodeURIComponent('1; DROP TABLE members'));
    expect(db_.listCalls()[1].sql).toMatch(/ORDER BY m\.joined_at DESC NULLS LAST, m\.id/);
    expect(db_.listCalls()[1].sql).not.toMatch(/DROP/);
  });

  it('filters members with no tribe / no city', async () => {
    const db_ = stubDb();
    await get('/api/admin/members?status=all&tribe_id=none&city_id=none');
    const sql = db_.listCalls()[0].sql;
    expect(sql).toMatch(/m\.city_id IS NULL/);
    expect(sql).toMatch(/m\.tribe_id IS NULL/);
  });

  it('falls back to the base-schema query on 42703', async () => {
    const db_ = stubDb({ fail42703: true });
    const res = await get('/api/admin/members?status=all&tribe_id=none');
    expect(res.status).toBe(200);
    const calls = db_.listCalls();
    expect(calls).toHaveLength(2);
    expect(calls[1].sql).not.toMatch(/LEFT JOIN tribes/);
    expect(calls[1].sql).not.toMatch(/tribe_id/);
    expect(res.body.members).toHaveLength(1);
  });

  it('exports every matching row as CSV (no LIMIT) with formulas neutralised', async () => {
    const db_ = stubDb({ rows: [listRow(), listRow({ first_name: '=HYPERLINK("x")', last_name: 'O"Brien, Jr' })] });
    const res = await get('/api/admin/members?status=all&format=csv');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/csv/);
    expect(res.headers['content-disposition']).toMatch(/atp-members-\d{4}-\d{2}-\d{2}\.csv/);
    expect(db_.listCalls()[0].sql).not.toMatch(/LIMIT/);
    const lines = res.text.split('\n');
    expect(lines[0].startsWith('member_number,first_name,last_name,email,phone,account_status')).toBe(true);
    expect(lines).toHaveLength(3);
    expect(lines[2]).toContain('"\'=HYPERLINK(""x"")"');
    expect(lines[2]).toContain('"O""Brien, Jr"');
    expect(res.text).not.toMatch(/password/i);
  });

  it('is admin-only', async () => {
    stubDb({ admin: false });
    const res = await get('/api/admin/members?status=all');
    expect(res.status).toBe(403);
  });
});

describe('GET /api/admin/members/:id — detail drawer', () => {
  it('returns the full record without password hash or tokens', async () => {
    const db_ = stubDb({ detail: { pending_deletion_at: '2026-10-01T00:00:00Z' } });
    const res = await get('/api/admin/members/' + MEMBER_ID);
    expect(res.status).toBe(200);
    const detailSql = db_.calls.find((c) => /to_jsonb\(m\)/.test(c.sql)).sql;
    expect(detailSql).toMatch(/to_jsonb\(m\) - 'password_hash'/);
    expect(res.body.member.first_name).toBe('Sara');
    expect(res.body.member.has_password).toBe(true);
    expect(res.body.member.account_status).toBe('pending_deletion');
    expect(res.body.member).not.toHaveProperty('reset_token');
    expect(res.body.member).not.toHaveProperty('totp_secret');
    expect(JSON.stringify(res.body)).not.toMatch(/leak-me/);
    expect(res.body.stats.attended).toBe(7);
    expect(res.body.push_devices).toEqual([{ platform: 'ios', devices: 1, last_seen_at: '2026-10-01T00:00:00Z' }]);
    expect(res.body.wallet).toEqual({ balance_aed: 0, pending_aed: 0 });
  });

  it('404s on a malformed id without touching the database', async () => {
    const db_ = stubDb();
    const res = await get('/api/admin/members/not-a-uuid');
    expect(res.status).toBe(404);
    expect(db_.calls.some((c) => /to_jsonb/.test(c.sql))).toBe(false);
  });

  it('404s on an unknown member', async () => {
    stubDb({ detail: null });
    const res = await get('/api/admin/members/' + MEMBER_ID);
    expect(res.status).toBe(404);
  });
});
