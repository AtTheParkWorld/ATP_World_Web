/**
 * Authentication middleware tests.
 *
 * Hits routes that require `authenticate` and asserts the right
 * 401 / 403 responses on bad / missing tokens. No DB needed for the
 * negative cases.
 */
// describe / it / expect are injected as globals by Vitest.
const request = require('supertest');
const app = require('../src/server');

describe('authenticate middleware — negative cases', () => {
  it('rejects requests without a Bearer token', async () => {
    const res = await request(app).get('/api/members/bookings');
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/no token/i);
  });

  it('rejects malformed Authorization headers', async () => {
    const res = await request(app)
      .get('/api/members/bookings')
      .set('Authorization', 'NotBearer abc');
    expect(res.status).toBe(401);
  });

  it('rejects an invalid JWT', async () => {
    const res = await request(app)
      .get('/api/members/bookings')
      .set('Authorization', 'Bearer not-a-real-jwt');
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/invalid|expired/i);
  });
});

describe('admin-only routes', () => {
  it('reject unauthenticated callers', async () => {
    const res = await request(app).get('/api/admin/members');
    expect(res.status).toBe(401);
  });

  it('reject members-only-tokens (no admin flag)', async () => {
    // We can't mint a real-but-non-admin token without a DB, so this
    // just confirms the auth gate fires. Full role-check is covered
    // by integration tests when TEST_DATABASE_URL is set.
    const res = await request(app)
      .get('/api/admin/members')
      .set('Authorization', 'Bearer this.is.not.real');
    expect(res.status).toBe(401);
  });
});
