import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

/**
 * Opt-in live contract run: `npm run test:live`. Never used by `npm test` or CI.
 *
 * Setting LIVE_BACKEND here only switches the suite on; src/test/live-guard.ts
 * still refuses to start unless every LIVE_* variable describes a disposable
 * backend seeded for this run (see frontend/README.md). Runs serially, stops
 * at the first failure and never retries, so a mutating request is sent once.
 */
export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: "node",
    include: ["src/lib/api/schemas/live-contract.test.ts"],
    env: { LIVE_BACKEND: "1" },
    retry: 0,
    bail: 1,
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
