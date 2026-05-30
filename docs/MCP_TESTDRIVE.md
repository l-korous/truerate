# Test-driving the MCP server in Claude Desktop (dummy data)

The MCP server can run fully locally with a seeded demo user, so you can try it
in Claude Desktop without Azure, a database, or even the API running. The seed
loads a realistic membership stack and prints a ready-to-use bearer token.

## 1. Start the MCP server with the dev seed

From the repo root (Node 20+, `pnpm install` already done):

```bash
pnpm --filter @truerate/core build   # one-time, MCP imports core's build

TRUERATE_INMEMORY=true \
TRUERATE_DEV_SEED=true \
TRUERATE_JWT_SECRET=dev-secret \
pnpm dev:mcp
```

On boot it prints a banner with a **bearer token** and the endpoint
`http://localhost:8788/mcp`. The seeded user `demo@truerate.dev` holds:
Booking Genius L3, Marriott Bonvoy Platinum, Hilton Honors Gold, Revolut Metal,
and a custom "Hotel PECR" 15% negotiated rate. Copy that token.

(`TRUERATE_JWT_SECRET` can be any string for local use; it just has to match the
running server. The token is valid for 30 days.)

## 2. Point Claude Desktop at it

Claude Desktop connects over stdio, so we bridge the HTTP server with
`mcp-remote` (fetched on demand via `npx`). Edit the config file:

- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Windows: `%APPDATA%\Claude\claude_desktop_config.json`

```jsonc
{
  "mcpServers": {
    "truerate": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "http://localhost:8788/mcp", "--header", "Authorization:${AUTH_HEADER}"],
      "env": { "AUTH_HEADER": "Bearer PASTE_THE_TOKEN_HERE" }
    }
  }
}
```

The token goes in the `env` value (as `Bearer <token>`) and is referenced as
`${AUTH_HEADER}` in the header. This avoids a known Claude Desktop quirk where
spaces inside an `args` string get mangled.

## 3. Restart Claude Desktop and try it

Fully quit and reopen Claude Desktop. You should see a `truerate` MCP server with
two tools. Then ask, for example:

- "Using TrueRate, what memberships do I have and what do they get me?"
  → calls `get_membership_summary`.
- "Find me a hotel in Prague for two nights in July using TrueRate."
  → calls `search_hotels`; you'll see public vs. indicative member prices and
  perks (the Marriott property shows Genius's discount stacked with Platinum
  perks).

Hotel data is deterministic mock data (no Booking credentials needed), so prices
are stable demo values. Member prices are flagged as indicative estimates.

## Troubleshooting

- **Tools don't appear**: confirm the server is running (`curl localhost:8788/health`
  returns `{"ok":true,...}`) and that you fully restarted Claude Desktop.
- **401 / auth errors**: the token must match the server's `TRUERATE_JWT_SECRET`.
  If you restarted the server, it minted a new token — update the config.
- **`npx` not found**: install Node 20+ so Claude Desktop can run `npx mcp-remote`.
- **Inspect manually**: `npx @modelcontextprotocol/inspector` and connect to
  `http://localhost:8788/mcp` with header `Authorization: Bearer <token>`.
