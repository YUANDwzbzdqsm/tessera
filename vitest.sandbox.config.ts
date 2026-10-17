import { defineConfig } from 'vitest/config';

// The sandbox tests call lockdown(), which freezes every intrinsic in the process.
// They run in their own forked process so the rest of the suite is unaffected.
export default defineConfig({
  test: {
    include: ['packages/*/test/**/*.sandbox.ts'],
    pool: 'forks',
  },
});
