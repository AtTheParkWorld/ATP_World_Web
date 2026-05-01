/**
 * Smoke test — ensures the Express app boots, /health responds, and
 * unknown routes return a JSON 404. Runs with no DB required (the
 * health endpoint doesn't query Postgres).
 */
const { describe, it, expect } = require('vitest');
const request = require('supertest');
const app = require('../src/server');

describe('app boot + health', () => {
  it('GET /health returns ok', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.service).toMatch(/ATP/i);
    expect(res.body.time).toBeTruthy();
  });

  it('unknown /api routes return JSON 404', async () => {
    const res = await request(app).get('/api/this-route-does-not-exist');
    expect(res.status).toBe(404);
    expect(res.body.error).toBeTruthy();
  });

  it('static SPA pages 200 with HTML', async () => {
    const res = await request(app).get('/profile');
    // /profile is mapped to public/profile.html via res.sendFile
    expect([200, 304]).toContain(res.status);
    expect(res.headers['content-type'] || '').toMatch(/html/i);
  });
});
