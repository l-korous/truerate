import { defineConfig, devices } from "@playwright/test";

// Boots the API (in-memory, no Azure) and then runs the extension e2e tests.
// The extension must be built before running tests:
//   pnpm --filter @truerate/extension build
//   pnpm --filter @truerate/extension test:e2e
//
// In CI the extension build step runs before this job.

const API_PORT = 8787;

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  reporter: "list",
  use: {
    trace: "on-first-retry",
  },
  projects: [{ name: "extension", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    // Run from workspace root so pnpm can resolve @truerate/api.
    command: "cd ../.. && pnpm --filter @truerate/api exec node --import tsx src/index.ts",
    port: API_PORT,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
    env: {
      TRUERATE_INMEMORY: "true",
      TRUERATE_JWT_SECRET: "e2e-ext-secret",
      TRUERATE_CRED_KEY: "Zm9vYmFyZm9vYmFyZm9vYmFyZm9vYmFyMTIzNDU2Nzg=",
      API_PORT: String(API_PORT),
    },
  },
});
