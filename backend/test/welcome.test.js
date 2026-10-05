/**
 * Founder welcome — Coach Fredy's note in a new member's inbox.
 *
 * No real Postgres needed: db.query() calls pool.query() on every call,
 * so spying on the pool swaps in a tiny in-memory notifications table
 * that honours the service's "insert only if absent" guard.
 */
// describe / it / expect / vi are injected as globals by Vitest.
const request = require('supertest');
const db = require('../src/db');
const app = require('../src/server');
const welcome = require('../src/services/welcomeMessage');

/** Fake pool. `opts.failWelcome` makes the welcome insert throw;
 *  `opts.existingEmail` makes the register duplicate check hit. */
function stubDb(opts = {}) {
  const notifications = [];
  const fakeQuery = async (text, params = []) => {
    const sql = String(text);
    if (/INSERT INTO notifications/i.test(sql) && params[1] === welcome.FOUNDER_WELCOME_TYPE) {
      if (opts.failWelcome) throw new Error('notifications insert failed');
      const exists = notifications.some((n) => n.member_id === params[0] && n.type === params[1]);
      if (exists) return { rows: [], rowCount: 0 };
      notifications.push({ member_id: params[0], type: params[1], title: params[2], body: params[3] });
      return { rows: [{ id: 'n' + notifications.length }], rowCount: 1 };
    }
    if (/SELECT id FROM members WHERE LOWER\(email\)/i.test(sql)) {
      return { rows: opts.existingEmail ? [{ id: 'existing-member' }] : [], rowCount: 0 };
    }
    if (/INSERT INTO members/i.test(sql)) {
      const [id, member_number, first_name, last_name, email] = params;
      return { rows: [{ id, member_number, first_name, last_name, email }], rowCount: 1 };
    }
    return { rows: [], rowCount: 0 };
  };
  vi.spyOn(db.pool, 'query').mockImplementation(fakeQuery);
  vi.spyOn(db.pool, 'connect').mockImplementation(async () => ({ query: fakeQuery, release() {} }));
  return { notifications };
}

const welcomes = (store) => store.notifications.filter((n) => n.type === welcome.FOUNDER_WELCOME_TYPE);
const settle = () => new Promise((r) => setTimeout(r, 50));

afterEach(() => { vi.restoreAllMocks(); });

describe('welcome text', () => {
  it('greets the member by first name and is signed by Coach Fredy', () => {
    const t = welcome.welcomeText('Sara');
    expect(t.startsWith('Hey Sara,')).toBe(true);
    expect(t).toMatch(/— Coach Fredy, founder of At The Park$/);
    expect(t).not.toMatch(/\{first_name\}/);
  });

  it('falls back to "there" for missing or placeholder names', () => {
    for (const n of [undefined, '', '  ', 'Member', 'Friend']) {
      expect(welcome.welcomeText(n).startsWith('Hey there,')).toBe(true);
    }
  });

  it('stays short (60–90 words)', () => {
    const words = welcome.FOUNDER_WELCOME_MESSAGE.split(/\s+/).filter((w) => /\w/.test(w)).length;
    expect(words).toBeGreaterThanOrEqual(60);
    expect(words).toBeLessThanOrEqual(90);
  });
});

describe('sendWelcomeMessage', () => {
  it('inserts once per member — a repeat call is a no-op', async () => {
    const store = stubDb();
    const memberId = '11111111-1111-4111-8111-111111111111';
    expect(await welcome.sendWelcomeMessage(memberId, 'Sara')).toEqual({ sent: true });
    expect(await welcome.sendWelcomeMessage(memberId, 'Sara')).toEqual({ skipped: 'already_sent' });
    expect(welcomes(store)).toHaveLength(1);
    expect(welcomes(store)[0].title).toBe('A message from Coach Fredy');
  });

  it('never throws when the insert fails', async () => {
    stubDb({ failWelcome: true });
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    await expect(welcome.sendWelcomeMessage('22222222-2222-4222-8222-222222222222', 'Sara'))
      .resolves.toEqual({ skipped: 'error' });
  });
});

describe('POST /api/auth/register — founder welcome', () => {
  it('puts exactly one welcome in the new member\'s inbox', async () => {
    const store = stubDb();
    const res = await request(app)
      .post('/api/auth/register')
      .send({ first_name: 'Sara', last_name: 'K', email: 'sara.welcome@example.com', password: 'pw-123456' });
    expect(res.status).toBe(201);
    await vi.waitFor(() => expect(welcomes(store)).toHaveLength(1));
    await settle();
    expect(welcomes(store)).toHaveLength(1);
    expect(welcomes(store)[0].member_id).toBe(res.body.member.id);
    expect(welcomes(store)[0].body.startsWith('Hey Sara,')).toBe(true);
  });

  it('still signs the member up when the welcome insert throws', async () => {
    stubDb({ failWelcome: true });
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const res = await request(app)
      .post('/api/auth/register')
      .send({ first_name: 'Omar', last_name: 'B', email: 'omar.welcome@example.com', password: 'pw-123456' });
    expect(res.status).toBe(201);
    expect(res.body.member && res.body.member.id).toBeTruthy();
  });

  it('sends nothing when the email already belongs to a member', async () => {
    const store = stubDb({ existingEmail: true });
    const res = await request(app)
      .post('/api/auth/register')
      .send({ first_name: 'Sara', last_name: 'K', email: 'taken@example.com' });
    expect(res.status).toBe(409);
    await settle();
    expect(welcomes(store)).toHaveLength(0);
  });
});
