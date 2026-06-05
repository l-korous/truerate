// Combined API + MCP server for the Playwright web+MCP cross-channel journey
// test (web-to-mcp-journey.spec.ts).
//
// Starting both servers in one Node.js process means they share the same
// MemoryUserRepo singleton: Node.js module caching resolves every
// `import ... from "@truerate/core"` to the same physical files in
// packages/core/, so getUserRepo() returns one instance for both servers.
//
// This is the same mechanism used by api-to-mcp-journey.test.ts in apps/mcp/.
//
// Environment variables (set by playwright.config.ts webServer env):
//   TRUERATE_INMEMORY=true — in-memory repo, no Azure
//   TRUERATE_JWT_SECRET   — shared JWT secret for API and MCP auth
//   TRUERATE_CRED_KEY     — credential encryption key
//   API_PORT (default 8787)
//   MCP_PORT (default 8788)
//   MCP_PUBLIC_URL        — used by the API when building the MCP URL shown to users
//
// tsx resolves .js import specifiers to their .ts source counterparts, so these
// side-effect imports boot the actual TypeScript servers.
import "../../api/src/index.js";
import "../../mcp/src/index.js";
