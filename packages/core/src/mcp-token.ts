import { createHash, randomBytes } from "node:crypto";

// Per-user MCP URL credential (issue #82).
//
// Each user can mint one opaque token; their personal MCP endpoint embeds it in
// the PATH — https://<host>/u/<token>/mcp — because MCP desktop clients (Claude
// Desktop, etc.) can't reliably attach custom auth headers, so the URL itself
// is the bearer secret (same shape as Notion/Linear remote-MCP URLs).
//
// Only a SHA-256 hash of the token is ever persisted (treat it like a
// password): a database read never yields a working token. The raw token is
// shown to the user exactly once, at issue time.

/** Bytes of entropy in an MCP token (32 bytes = 256 bits). */
const MCP_TOKEN_BYTES = 32;

/**
 * Generate a new opaque, URL-safe MCP token (base64url, no padding).
 * base64url uses only [A-Za-z0-9_-], all safe in a URL path segment.
 */
export function generateMcpToken(): string {
  return randomBytes(MCP_TOKEN_BYTES).toString("base64url");
}

/** One-way SHA-256 (hex) hash of an MCP token, for storage and lookup. */
export function hashMcpToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Build a user's personal MCP URL from the public MCP base URL and a raw token.
 * Trailing slashes on the base are normalised away.
 */
export function mcpUrlForToken(baseUrl: string, token: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/u/${token}/mcp`;
}
