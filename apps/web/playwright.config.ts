import { defineConfig, devices } from "@playwright/test";

// Boots the API (in-memory, no Azure), the MCP server, and the Next dev server,
// then runs the end-to-end journey against them. Run from the web package:
//   pnpm --filter @truerate/web test:e2e
// Commands cd to the repo root because Playwright runs them from this package.

const API_PORT = 8787;
const MCP_PORT = 8788;
const WEB_PORT = 3000;

export default defineConfig({
  testDir: "./e2e",
  timeout: 90_000,
  expect: { timeout: 15_000 },
  // 1 automatic retry in CI absorbs transient cold-start races without masking
  // real failures (a test that legitimately fails will fail on both attempts).
  retries: process.env.CI ? 1 : 0,
  fullyParallel: false,
  reporter: "list",
  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      // Combined API+MCP server in one Node.js process so they share the same
      // MemoryUserRepo singleton when TRUERATE_INMEMORY=true. This enables the
      // web-to-MCP cross-channel journey test (web-to-mcp-journey.spec.ts):
      // memberships added via the web UI appear in MCP results accessed via the
      // URL issued from the MCP tab — because both servers see one in-memory repo.
      command: "pnpm --filter @truerate/web exec node --import tsx e2e/combined-server.js",
      // Use the /health URL rather than port so Playwright waits until the API
      // is actually serving HTTP, not just that the TCP port is bound.
      url: `http://localhost:${API_PORT}/health`,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
      env: {
        TRUERATE_INMEMORY: "true",
        TRUERATE_JWT_SECRET: "e2e-secret",
        TRUERATE_CRED_KEY: "Zm9vYmFyZm9vYmFyZm9vYmFyZm9vYmFyMTIzNDU2Nzg=",
        API_PORT: String(API_PORT),
        MCP_PORT: String(MCP_PORT),
        // MCP_PUBLIC_URL defaults to http://localhost:8788 in the API when unset,
        // but we set it explicitly so the URL shown to the user is predictable.
        MCP_PUBLIC_URL: `http://localhost:${MCP_PORT}`,
      },
    },
    {
      command: "cd ../.. && pnpm --filter @truerate/web dev",
      // Use the root URL rather than port; Next.js dev binds the socket before
      // finishing compilation, so a port-only check can hand control to
      // Playwright while the first page request is still being compiled.
      url: `http://localhost:${WEB_PORT}`,
      reuseExistingServer: !process.env.CI,
      timeout: 150_000,
      env: { NEXT_PUBLIC_API_BASE_URL: `http://localhost:${API_PORT}` },
    },
  ],
});
