import { test } from "node:test";
import assert from "node:assert/strict";
import { buildClaudeDesktopSnippet, formatDate } from "../components/McpUrlManager";

// ── buildClaudeDesktopSnippet ────────────────────────────────────────────────

test("buildClaudeDesktopSnippet: produces valid JSON", () => {
  const snippet = buildClaudeDesktopSnippet("https://mcp.truerate.app/u/abc123/mcp");
  const parsed = JSON.parse(snippet);
  assert.ok(parsed.mcpServers, "must have mcpServers key");
});

test("buildClaudeDesktopSnippet: includes truerate server key", () => {
  const snippet = buildClaudeDesktopSnippet("https://mcp.truerate.app/u/abc123/mcp");
  const parsed = JSON.parse(snippet);
  assert.ok(parsed.mcpServers.truerate, "must have mcpServers.truerate");
});

test("buildClaudeDesktopSnippet: uses npx mcp-remote command", () => {
  const url = "https://mcp.truerate.app/u/abc123/mcp";
  const snippet = buildClaudeDesktopSnippet(url);
  const parsed = JSON.parse(snippet);
  const server = parsed.mcpServers.truerate;
  assert.equal(server.command, "npx");
  assert.ok(Array.isArray(server.args));
  assert.ok(server.args.includes("mcp-remote"), "args must include mcp-remote");
});

test("buildClaudeDesktopSnippet: embeds the user URL in args", () => {
  const url = "https://mcp.truerate.app/u/tok_abc123def456/mcp";
  const snippet = buildClaudeDesktopSnippet(url);
  const parsed = JSON.parse(snippet);
  const server = parsed.mcpServers.truerate;
  assert.ok(server.args.includes(url), "args must include the user's URL");
});

test("buildClaudeDesktopSnippet: snippet does not contain prices or price-related keys", () => {
  const snippet = buildClaudeDesktopSnippet("https://mcp.truerate.app/u/xyz/mcp");
  assert.ok(!snippet.includes("price"), "snippet must not reference prices");
  assert.ok(!snippet.includes("Price"), "snippet must not reference prices");
  assert.ok(!snippet.includes("cost"), "snippet must not reference costs");
});

test("buildClaudeDesktopSnippet: different URLs produce different snippets", () => {
  const s1 = buildClaudeDesktopSnippet("https://mcp.truerate.app/u/token1/mcp");
  const s2 = buildClaudeDesktopSnippet("https://mcp.truerate.app/u/token2/mcp");
  assert.notEqual(s1, s2);
});

test("buildClaudeDesktopSnippet: outputs pretty-printed JSON (indented)", () => {
  const snippet = buildClaudeDesktopSnippet("https://example.com/u/t/mcp");
  assert.ok(snippet.includes("\n"), "should be multi-line (pretty-printed)");
});

// ── formatDate ───────────────────────────────────────────────────────────────

test("formatDate: returns a non-empty string for a valid ISO date", () => {
  const result = formatDate("2025-03-15T10:30:00.000Z");
  assert.ok(typeof result === "string" && result.length > 0);
});

test("formatDate: includes the year for a 2025 date", () => {
  const result = formatDate("2025-03-15T10:30:00.000Z");
  assert.ok(result.includes("2025"), `expected year 2025 in "${result}"`);
});

test("formatDate: falls back gracefully for invalid input", () => {
  const result = formatDate("not-a-date");
  assert.ok(typeof result === "string");
});
