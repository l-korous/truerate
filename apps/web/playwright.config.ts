import { defineConfig, devices } from "@playwright/test";

// Boots the API (in-memory, no Azure) and the Next dev server, then runs the
// end-to-end journey against them. Run from the web package:
//   pnpm --filter @truerate/web test:e2e
// Commands cd to the repo root because Playwright runs them from this package.

const API_PORT = 8787;
const WEB_PORT = 3000;

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  reporter: "list",
  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command: "cd ../.. && node --import tsx apps/api/src/index.ts",
      port: API_PORT,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
      env: {
        TRUERATE_INMEMORY: "true",
        TRUERATE_JWT_SECRET: "e2e-secret",
        TRUERATE_CRED_KEY: "Zm9vYmFyZm9vYmFyZm9vYmFyZm9vYmFyMTIzNDU2Nzg=",
        API_PORT: String(API_PORT),
      },
    },
    {
      command: "cd ../.. && pnpm --filter @truerate/web dev",
      port: WEB_PORT,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      env: { NEXT_PUBLIC_API_BASE_URL: `http://localhost:${API_PORT}` },
    },
  ],
});
