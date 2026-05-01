// Vitest config — minimal. CommonJS Node, no transform needed.
// Tests live in backend/test/**/*.test.js. Coverage is opt-in via
// `npm run test:coverage`.
module.exports = {
  test: {
    environment: 'node',
    globals: false,
    include: ['test/**/*.test.js'],
    setupFiles: ['./test/setup.js'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'json'],
      include: ['src/**/*.js'],
      exclude: ['src/db/migrate.js', 'src/db/seed.js'],
    },
    testTimeout: 10000,
  },
};
