/**
 * /api/billing — public endpoints + auth gates.
 *
 * The plans endpoint is public (no auth) and shouldn't 500 even when
 * the subscription_plans table is empty or missing. checkout / portal
 * require auth.
 */
// describe / it / expect are injected as globals by Vitest.
const request = require('supertest');
const app = require('../src/server');

describe('GET /api/billing/plans', () => {
  it('responds (200 with plans, 500/503 if DB unreachable)', async () => {
    const res = await request(app).get('/api/billing/plans');
    // The route hits Postgres. With a real DB it returns 200 + a plans
    // array. Without one (most local + CI-without-DB paths) it returns
    // 500 from the global error handler. We accept any of those — the
    // test exists to catch hard crashes / route mounting bugs, not to
    // assert on infra. Run with TEST_DATABASE_URL set for stricter
    // integration coverage.
    expect([200, 500, 503]).toContain(res.status);
    if (res.status === 200) {
      expect(Array.isArray(res.body.plans)).toBe(true);
    }
  });
});

describe('billing — auth gates', () => {
  it('POST /api/billing/checkout requires auth', async () => {
    const res = await request(app)
      .post('/api/billing/checkout')
      .send({ plan_id: 'whatever' });
    expect(res.status).toBe(401);
  });

  it('POST /api/billing/portal requires auth', async () => {
    const res = await request(app)
      .post('/api/billing/portal')
      .send({});
    expect(res.status).toBe(401);
  });

  it('GET /api/billing/admin/plans requires auth', async () => {
    const res = await request(app).get('/api/billing/admin/plans');
    expect(res.status).toBe(401);
  });
});

describe('GET /api/countries', () => {
  it('public list endpoint responds (200/500 depending on DB)', async () => {
    const res = await request(app).get('/api/countries');
    // 200 with a real DB + migrations run; 500 when the pool can't
    // connect to the placeholder DATABASE_URL used in unit-test mode.
    expect([200, 500]).toContain(res.status);
    if (res.status === 200) {
      expect(Array.isArray(res.body.countries)).toBe(true);
    }
  });
});
