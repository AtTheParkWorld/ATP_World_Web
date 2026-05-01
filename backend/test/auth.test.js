/**
 * /api/auth — input-validation tests.
 *
 * These exercise the route's argument validation BEFORE any DB call,
 * so they don't need a real Postgres. Tests requiring DB writes are
 * marked .skipIf(!__hasTestDb) so they only run in CI / when
 * TEST_DATABASE_URL is set.
 */
// describe / it / expect are injected as globals by Vitest.
const request = require('supertest');
const app = require('../src/server');

describe('POST /api/auth/register — validation', () => {
  it('rejects when first_name missing', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ last_name: 'M', email: 'x@y.com' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/required/i);
  });

  it('rejects when email missing', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ first_name: 'F', last_name: 'M' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/required/i);
  });

  it('rejects when last_name missing', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ first_name: 'F', email: 'x@y.com' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/required/i);
  });
});

describe('POST /api/auth/login — validation', () => {
  it('rejects when email missing', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ password: 'whatever' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/required/i);
  });

  it('rejects when password missing', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'x@y.com' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/required/i);
  });
});

describe('migrate endpoints — auth', () => {
  it('rejects bad setupKey on migrate-billing', async () => {
    const res = await request(app)
      .post('/api/auth/migrate-billing')
      .send({ setupKey: 'wrong-key' });
    expect(res.status).toBe(401);
  });

  it('rejects bad setupKey on migrate-paid-sessions', async () => {
    const res = await request(app)
      .post('/api/auth/migrate-paid-sessions')
      .send({ setupKey: 'wrong-key' });
    expect(res.status).toBe(401);
  });

  it('rejects bad setupKey on migrate-countries', async () => {
    const res = await request(app)
      .post('/api/auth/migrate-countries')
      .send({ setupKey: 'wrong-key' });
    expect(res.status).toBe(401);
  });
});
