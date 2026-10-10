import { defineConfig } from 'vitest/config';

export default defineConfig({
  css: {
    postcss: {
      plugins: [],
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['packages/**/*.{test,spec}.ts'],
    globalSetup: ['./vitest.global-setup.ts'],
    // One forked process, not a worker thread: better-sqlite3 and node-pty segfault while a worker
    // thread shuts down once enough tests have run (all tests pass, then the run exits 139).
    pool: 'forks',
    poolOptions: {
      forks: {
        singleFork: true,
      },
    },
  },
});
