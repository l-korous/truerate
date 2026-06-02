import { createRateLimiter } from "@truerate/core";

// Default: 30 MCP requests per minute per authenticated user.
// Override with RATE_LIMIT_WINDOW_MS / RATE_LIMIT_MAX env vars.
export const mcpLimiter = createRateLimiter(30);
