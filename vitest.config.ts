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
    pool: 'forks',
    isolate: false,
    poolOptions: {
      forks: {
        singleFork: true,
      },
    },
  },
});
