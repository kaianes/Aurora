import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    root: './',
    include: ['**/*.e2e-spec.ts'],
    // Recreates a real, disposable Postgres database (aurora_test), runs
    // every migration, and provisions the aurora_app role -- once per
    // suite run, before any spec file. See test/e2e/global-setup.ts.
    globalSetup: ['./test/e2e/global-setup.ts'],
    // These tests share one real database; running files in parallel
    // worker pools risks cross-file interference on shared tables.
    fileParallelism: false,
    testTimeout: 15000,
    hookTimeout: 30000,
  },
});
