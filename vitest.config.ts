import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Host-side unit tests live in the packages. `examples/` holds Argus test
    // fixtures (they use Argus globals and run ON Hermes, not in Vitest) — they
    // must NOT be discovered here.
    include: ['packages/**/*.test.ts', 'test/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**', 'examples/**'],
  },
});
