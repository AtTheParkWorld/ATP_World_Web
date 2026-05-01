/**
 * Global test setup — runs once before any test file.
 *
 * Sets defaults for required env vars so the app can boot in test mode
 * without hitting "JWT_SECRET missing" type errors. Real values land
 * via TEST_DATABASE_URL etc. in CI; locally these defaults are fine for
 * unit-level tests that don't actually hit the database.
 */
process.env.NODE_ENV = process.env.NODE_ENV || 'test';

// Required by middleware/auth.js — any non-empty string works for tests
// that don't actually verify a real token.
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-do-not-use-in-prod';

// Required by some migrations + admin endpoints. Tests that exercise
// those endpoints can override per-test.
process.env.ADMIN_SETUP_KEY = process.env.ADMIN_SETUP_KEY || 'test-setup-key';

// If a real test database URL isn't provided, point DATABASE_URL at a
// throwaway value so the pg pool doesn't crash on import. DB-backed
// tests use `describe.runIf(hasTestDb)` to skip themselves cleanly.
if (!process.env.DATABASE_URL && !process.env.TEST_DATABASE_URL) {
  process.env.DATABASE_URL = 'postgres://test:test@127.0.0.1:5432/atp_test_unused';
}
if (process.env.TEST_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
}

// Don't actually try to send emails in tests.
process.env.SENDGRID_API_KEY = process.env.SENDGRID_API_KEY || '';

// Stripe lazy-inits, so leaving the key blank is fine — billing tests
// that need it can mock the service instead.
process.env.STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || '';

// Helper exposed on globalThis so test files can detect whether a real
// DB is attached.
globalThis.__hasTestDb = Boolean(process.env.TEST_DATABASE_URL);
