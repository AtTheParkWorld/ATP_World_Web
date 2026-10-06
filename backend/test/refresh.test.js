/**
 * Mobile session persistence — POST /api/auth/refresh + /api/auth/logout.
 *
 * Founder 2026-10-06: closing the app without signing out sent members
 * back to the login screen. On reopening, every screen's request got a
 * 401 (the 1h access token had lapsed) and each called /refresh with the
 * same refresh token; the second call was taken for a replay and revoked
 * every token the member had.
 *
 * No real Postgres: db.query() calls pool.query() on every call, so the
 * pool is swapped for a tiny in-memory refresh_tokens table that answers
 * the statements routes/auth.js sends. A transaction pins one NOW() for
 * all its statements, as Postgres does — the successor link relies on it.
 */
// describe / it / expect / vi are injected as globals by Vitest.
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const request = require('supertest');
const db = require('../src/db');
const app = require('../src/server');

const MEMBER = '11111111-1111-4111-8111-111111111111';
const OTHER_DEVICE = 'other-device-token';
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

function stubDb() {
  const tokens = [];
  let seq = 0;
  const add = (plain, extra = {}) => {
    const now = new Date();
    const row = {
      id: 'rt' + (++seq), member_id: MEMBER, token_hash: sha(plain),
      expires_at: new Date(Date.now() + 90 * 86400 * 1000),
      revoked_at: null, last_used_at: null, created_at: now, ...extra,
    };
    tokens.push(row);
    return row;
  };
  const byId = (id) => tokens.find((t) => t.id === id);
  // Set flags.staleRevokedAt to make the next lookup answer from a
  // snapshot taken before a concurrent request committed (READ
  // COMMITTED: the row still shows its old revoked_at).
  const flags = { staleRevokedAt: null };

  const handle = (sql, params, now) => {
    if (/^\s*(BEGIN|COMMIT|ROLLBACK)/i.test(sql)) return { rows: [] };
    if (/FROM refresh_tokens rt\s+JOIN members m/i.test(sql)) {
      const t = tokens.find((x) => x.token_hash === params[0]);
      if (!t) return { rows: [] };
      const revokedAt = flags.staleRevokedAt || t.revoked_at;
      flags.staleRevokedAt = null;
      return { rows: [{
        id: t.id, member_id: t.member_id, expires_at: t.expires_at, revoked_at: revokedAt,
        revoked_at_exact: revokedAt ? revokedAt.toISOString() : null,
        rotated: !!t.revoked_at && !!t.last_used_at && +t.last_used_at === +t.revoked_at,
        in_grace: !!revokedAt && +revokedAt > +now - params[1] * 1000,
        is_banned: false,
      }] };
    }
    // Re-check inside the recovery transaction (fresh statement snapshot).
    if (/SELECT 1 FROM refresh_tokens\s+WHERE id = \$1 AND revoked_at > NOW\(\)/i.test(sql)) {
      const t = byId(params[0]);
      return { rows: t && t.revoked_at && +t.revoked_at > +now - params[1] * 1000 ? [{ '?column?': 1 }] : [] };
    }
    if (/INSERT INTO refresh_tokens/i.test(sql)) {
      tokens.push({
        id: 'rt' + (++seq), member_id: params[0], token_hash: params[1],
        expires_at: params[5], revoked_at: null, last_used_at: null, created_at: now,
      });
      return { rows: [], rowCount: 1 };
    }
    // Successor lookup (lost-response recovery).
    if (/UPDATE refresh_tokens s SET revoked_at = NOW\(\)\s+FROM refresh_tokens o/i.test(sql)) {
      const o = byId(params[0]);
      const pinned = o && o.revoked_at && +o.revoked_at === +new Date(params[1]);
      const s = pinned && tokens.find((x) => x.member_id === o.member_id && !x.revoked_at
        && +x.created_at === +o.revoked_at);
      if (!s) return { rows: [] };
      s.revoked_at = now;
      return { rows: [{ id: s.id }] };
    }
    // Rotation stamp — conditional (normal rotate) or unconditional (relink).
    if (/SET revoked_at = NOW\(\), last_used_at = NOW\(\)\s+WHERE id = \$1/i.test(sql)) {
      const t = byId(params[0]);
      const conditional = /AND revoked_at IS NULL/i.test(sql);
      if (t && (!conditional || !t.revoked_at)) { t.revoked_at = now; t.last_used_at = now; return { rows: [], rowCount: 1 }; }
      return { rows: [], rowCount: 0 };
    }
    // Replay defence: revoke every live token for the member.
    if (/SET revoked_at = NOW\(\)\s+WHERE member_id = \$1 AND revoked_at IS NULL/i.test(sql)) {
      let n = 0;
      tokens.forEach((t) => { if (t.member_id === params[0] && !t.revoked_at) { t.revoked_at = now; n++; } });
      return { rows: [], rowCount: n };
    }
    // Sign-out.
    if (/SET revoked_at = NOW\(\)\s+WHERE token_hash = \$1 AND revoked_at IS NULL/i.test(sql)) {
      const t = tokens.find((x) => x.token_hash === params[0] && !x.revoked_at);
      if (t) t.revoked_at = now;
      return { rows: [], rowCount: t ? 1 : 0 };
    }
    throw new Error('unexpected SQL in refresh test: ' + sql.slice(0, 80));
  };

  vi.spyOn(db.pool, 'query').mockImplementation(async (sql, params = []) => handle(String(sql), params, new Date()));
  vi.spyOn(db.pool, 'connect').mockImplementation(async () => {
    let txNow = null;
    return {
      async query(sql, params = []) {
        if (/^\s*BEGIN/i.test(String(sql))) txNow = new Date();
        return handle(String(sql), params, txNow || new Date());
      },
      release() {},
    };
  });

  const live = () => tokens.filter((t) => !t.revoked_at);
  return { tokens, add, live, flags };
}

const refresh = (token) => request(app).post('/api/auth/refresh')
  .set('X-Mobile-Platform', 'android').send({ refresh_token: token });

/** A timestamp outside the sibling grace window. Tests stamp it on the
 *  old token's revoked_at/last_used_at AND its successor's created_at,
 *  keeping the successor link (created_at === revoked_at) intact. */
const minutesAgo = (mins) => new Date(Date.now() - mins * 60 * 1000);

afterEach(() => { vi.restoreAllMocks(); });

describe('POST /api/auth/refresh — rotation', () => {
  it('swaps a live refresh token for a new pair and retires the old one', async () => {
    const store = stubDb();
    const t0 = store.add('token-0');
    const res = await refresh('token-0');
    expect(res.status).toBe(200);
    expect(typeof res.body.refresh_token).toBe('string');
    expect(res.body.refresh_token).not.toBe('token-0');
    expect(jwt.verify(res.body.access_token, process.env.JWT_SECRET).sub).toBe(MEMBER);
    expect(t0.revoked_at).toBeTruthy();
    expect(+t0.last_used_at).toBe(+t0.revoked_at);
    // The new token is the old one's successor (same transaction NOW()).
    const t1 = store.tokens.find((t) => t.token_hash === sha(res.body.refresh_token));
    expect(+t1.created_at).toBe(+t0.revoked_at);
    // ...and it refreshes in turn.
    expect((await refresh(res.body.refresh_token)).status).toBe(200);
  });

  it('400s without a token and 401s an unknown one', async () => {
    stubDb();
    expect((await request(app).post('/api/auth/refresh').send({})).status).toBe(400);
    const res = await refresh('never-issued');
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('INVALID_REFRESH');
  });

  it('401s an expired token', async () => {
    const store = stubDb();
    store.add('stale', { expires_at: new Date(Date.now() - 1000) });
    const res = await refresh('stale');
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('REFRESH_EXPIRED');
  });
});

describe('POST /api/auth/refresh — reopening the app', () => {
  it('several screens refreshing with the same token all succeed and the member stays signed in', async () => {
    const store = stubDb();
    store.add('token-0');
    store.add(OTHER_DEVICE);
    // What the app does on reopen: every query 401s at once and each
    // asks for a refresh with the token it holds.
    const results = await Promise.all([1, 2, 3, 4, 5].map(() => refresh('token-0')));
    results.forEach((r) => {
      expect(r.status).toBe(200);
      expect(typeof r.body.refresh_token).toBe('string');
    });
    // Nothing was mass-revoked: the member's other phone still works...
    expect(store.live().some((t) => t.token_hash === sha(OTHER_DEVICE))).toBe(true);
    // ...and whichever new token this phone kept keeps working.
    const kept = results[results.length - 1].body.refresh_token;
    expect((await refresh(kept)).status).toBe(200);
  });

  it('a sibling call that lands just after the rotation (inside the grace window) succeeds', async () => {
    const store = stubDb();
    store.add('token-0');
    const first = await refresh('token-0');
    expect(first.status).toBe(200);
    const late = await refresh('token-0');
    expect(late.status).toBe(200);
    expect(late.body.refresh_token).not.toBe(first.body.refresh_token);
    expect(store.live().length).toBeGreaterThanOrEqual(2);
  });

  it('recovers when the phone never saved the rotated token (app closed mid-refresh)', async () => {
    const store = stubDb();
    const t0 = store.add('token-0');
    const lost = await refresh('token-0'); // server rotated; response never stored
    expect(lost.status).toBe(200);
    const t1 = store.tokens.find((t) => t.token_hash === sha(lost.body.refresh_token));
    // Hours later the app opens again, still holding token-0.
    const then = minutesAgo(30);
    t0.revoked_at = then; t0.last_used_at = then; t1.created_at = then;

    const res = await refresh('token-0');
    expect(res.status).toBe(200);
    // The unused successor is retired, without the rotation stamp, so it
    // can never be used later.
    expect(t1.revoked_at).toBeTruthy();
    expect(t1.last_used_at).toBeNull();
    // And the new token works.
    expect((await refresh(res.body.refresh_token)).status).toBe(200);
  });

  it('a second lost response recovers too', async () => {
    const store = stubDb();
    const t0 = store.add('token-0');
    const a = await refresh('token-0');
    const t1 = store.tokens.find((t) => t.token_hash === sha(a.body.refresh_token));
    let then = minutesAgo(60);
    t0.revoked_at = then; t0.last_used_at = then; t1.created_at = then;
    const b = await refresh('token-0'); // recovery — response lost again
    expect(b.status).toBe(200);
    const t2 = store.tokens.find((t) => t.token_hash === sha(b.body.refresh_token));
    then = minutesAgo(30);
    t0.revoked_at = then; t0.last_used_at = then; t2.created_at = then;
    const c = await refresh('token-0');
    expect(c.status).toBe(200);
  });
});

describe('POST /api/auth/refresh — racing recoveries', () => {
  it('the request that loses the successor to a sibling recovery still gets in', async () => {
    const store = stubDb();
    const t0 = store.add('token-0');
    const a = await refresh('token-0');
    const t1 = store.tokens.find((t) => t.token_hash === sha(a.body.refresh_token));
    const then = minutesAgo(30);
    t0.revoked_at = then; t0.last_used_at = then; t1.created_at = then;
    // A sibling from the same burst has just recovered: it retired t1,
    // re-stamped t0 and minted its own token, linked to t0...
    const now = new Date();
    t1.revoked_at = now; t0.revoked_at = now; t0.last_used_at = now;
    const sibling = store.add('sibling-new', { created_at: now });
    // ...but this request read t0 before that committed.
    store.flags.staleRevokedAt = then;
    const res = await refresh('token-0');
    expect(res.status).toBe(200);
    expect(sibling.revoked_at).toBeNull(); // no wipe
  });
});

describe('POST /api/auth/refresh — replay defence still holds', () => {
  it('an old token presented after its successor was used revokes everything', async () => {
    const store = stubDb();
    const t0 = store.add('token-0');
    store.add(OTHER_DEVICE);
    const a = await refresh('token-0');
    const t1 = store.tokens.find((t) => t.token_hash === sha(a.body.refresh_token));
    const b = await refresh(a.body.refresh_token); // the phone moved on (t1 → t2)
    expect(b.status).toBe(200);
    const then = minutesAgo(30);
    t0.revoked_at = then; t0.last_used_at = then; t1.created_at = then;

    const res = await refresh('token-0'); // someone else holding the old copy
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('TOKEN_REVOKED');
    expect(store.live().length).toBe(0);
  });

  it('a token that was revoked by sign-out is a replay, not a race', async () => {
    const store = stubDb();
    store.add('token-0');
    store.add(OTHER_DEVICE);
    expect((await request(app).post('/api/auth/logout').send({ refresh_token: 'token-0' })).status).toBe(200);
    const res = await refresh('token-0');
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('TOKEN_REVOKED');
    expect(store.live().length).toBe(0);
  });

  it('the successor retired by a recovery cannot be used afterwards', async () => {
    const store = stubDb();
    const t0 = store.add('token-0');
    const a = await refresh('token-0');
    const t1 = store.tokens.find((t) => t.token_hash === sha(a.body.refresh_token));
    const then = minutesAgo(30);
    t0.revoked_at = then; t0.last_used_at = then; t1.created_at = then;
    expect((await refresh('token-0')).status).toBe(200); // e.g. a thief with the old copy
    const res = await refresh(a.body.refresh_token);      // the real phone shows up
    expect(res.status).toBe(401);
    expect(store.live().length).toBe(0);
  });
});

describe('POST /api/auth/logout', () => {
  it('revokes the refresh token the app sends, without needing a bearer token', async () => {
    const store = stubDb();
    const t0 = store.add('token-0');
    const other = store.add(OTHER_DEVICE);
    const res = await request(app).post('/api/auth/logout').send({ refresh_token: 'token-0' });
    expect(res.status).toBe(200);
    expect(t0.revoked_at).toBeTruthy();
    expect(other.revoked_at).toBeNull(); // only this phone is signed out
  });

  it('still answers 200 for a web sign-out with no refresh token', async () => {
    stubDb();
    const res = await request(app).post('/api/auth/logout').send({});
    expect(res.status).toBe(200);
  });
});
