/**
 * Founder welcome — Coach Fredy's DM to every new member.
 *
 * No real Postgres needed: db.query() calls pool.query() on every call,
 * so spying on the pool swaps in tiny in-memory members / conversations /
 * messages tables that honour the service's "send once" guard.
 */
// describe / it / expect / vi are injected as globals by Vitest.
const request = require('supertest');
const db = require('../src/db');
const app = require('../src/server');
const welcome = require('../src/services/welcomeMessage');

const FOUNDER = welcome.FOUNDER_MEMBER_ID;

/** Fake pool. `opts.failWelcome` makes the message insert throw;
 *  `opts.existingEmail` makes the register duplicate check hit;
 *  `opts.noFounder` removes Fredy's account so the admin fallback runs. */
function stubDb(opts = {}) {
  const members = new Set(opts.noFounder ? [] : [FOUNDER]);
  const conversations = [];
  const messages = [];
  const fakeQuery = async (text, params = []) => {
    const sql = String(text);
    if (/FROM system_config WHERE key='welcome_sender_id'/i.test(sql)) return { rows: [] };
    if (/SELECT id FROM members WHERE id=\$1/i.test(sql)) {
      return { rows: members.has(params[0]) ? [{ id: params[0] }] : [] };
    }
    if (/WHERE is_admin = true/i.test(sql)) return { rows: [{ id: 'aaaaaaaa-0000-4000-8000-000000000000' }] };
    if (/INSERT INTO conversations/i.test(sql)) {
      let c = conversations.find((x) => x.a === params[0] && x.b === params[1]);
      if (!c) { c = { id: 'c' + (conversations.length + 1), a: params[0], b: params[1] }; conversations.push(c); }
      return { rows: [{ id: c.id }] };
    }
    if (/SELECT 1 FROM messages WHERE conversation_id/i.test(sql)) {
      return { rows: messages.filter((m) => m.conversation_id === params[0] && m.sender_id === params[1]) };
    }
    if (/INSERT INTO messages/i.test(sql)) {
      if (opts.failWelcome) throw new Error('messages insert failed');
      messages.push({ conversation_id: params[0], sender_id: params[1], content: params[2] });
      return { rows: [], rowCount: 1 };
    }
    if (/SELECT id FROM members WHERE LOWER\(email\)/i.test(sql)) {
      return { rows: opts.existingEmail ? [{ id: 'existing-member' }] : [], rowCount: 0 };
    }
    if (/INSERT INTO members/i.test(sql)) {
      const [id, member_number, first_name, last_name, email] = params;
      members.add(id);
      return { rows: [{ id, member_number, first_name, last_name, email }], rowCount: 1 };
    }
    return { rows: [], rowCount: 0 };
  };
  vi.spyOn(db.pool, 'query').mockImplementation(fakeQuery);
  vi.spyOn(db.pool, 'connect').mockImplementation(async () => ({ query: fakeQuery, release() {} }));
  return { messages, conversations };
}

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
  it('sends one DM from Fredy — a repeat call is a no-op', async () => {
    const store = stubDb();
    const memberId = '11111111-1111-4111-8111-111111111111';
    expect(await welcome.sendWelcomeMessage(memberId, 'Sara')).toEqual({ sent: true });
    expect(await welcome.sendWelcomeMessage(memberId, 'Sara')).toEqual({ skipped: 'already_sent' });
    expect(store.messages).toHaveLength(1);
    expect(store.messages[0].sender_id).toBe(FOUNDER);
    expect(store.messages[0].content.startsWith('Hey Sara,')).toBe(true);
  });

  it('falls back to the longest-standing admin when Fredy\'s account is missing', async () => {
    const store = stubDb({ noFounder: true });
    await welcome.sendWelcomeMessage('33333333-3333-4333-8333-333333333333', 'Sara');
    expect(store.messages[0].sender_id).toBe('aaaaaaaa-0000-4000-8000-000000000000');
  });

  it('never throws when the insert fails', async () => {
    stubDb({ failWelcome: true });
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    await expect(welcome.sendWelcomeMessage('22222222-2222-4222-8222-222222222222', 'Sara'))
      .resolves.toEqual({ skipped: 'error' });
  });
});

describe('POST /api/auth/register — founder welcome', () => {
  it('sends exactly one welcome DM to the new member', async () => {
    const store = stubDb();
    const res = await request(app)
      .post('/api/auth/register')
      .send({ first_name: 'Sara', last_name: 'K', email: 'sara.welcome@example.com', password: 'pw-123456' });
    expect(res.status).toBe(201);
    await vi.waitFor(() => expect(store.messages).toHaveLength(1));
    await settle();
    expect(store.messages).toHaveLength(1);
    const conv = store.conversations[0];
    expect([conv.a, conv.b]).toContain(res.body.member.id);
    expect([conv.a, conv.b]).toContain(FOUNDER);
    expect(store.messages[0].content.startsWith('Hey Sara,')).toBe(true);
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
    expect(store.messages).toHaveLength(0);
  });
});
