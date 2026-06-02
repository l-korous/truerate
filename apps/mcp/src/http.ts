import { type IncomingMessage, type ServerResponse } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { verify } from "hono/jwt";
import {
  createLogger,
  generateCorrelationId,
  getUserRepo,
  hashMcpToken,
} from "@truerate/core";
import { buildServer, engine } from "./server.js";
import { mcpLimiter } from "./rate-limit.js";

// TrueRate MCP HTTP handler.
//
// Extracted from index.ts so the real routing/auth is exercised by tests rather
// than a replica. Two credential paths converge to a userId:
//   1. Authorization: Bearer <JWT>     — programmatic / legacy clients.
//   2. /u/<token>/mcp  (token in path) — per-user MCP URL (#82). MCP desktop
//      clients can't attach custom headers, so the URL itself is the secret;
//      the path token maps to a user via its stored SHA-256 hash.
//
// Transport: Streamable HTTP in STATELESS mode (fresh server+transport per
// request, no session map) so it scales across replicas with no Redis.

const log = createLogger({ service: "mcp" });

async function userIdFromBearer(req: IncomingMessage): Promise<string | null> {
  const header = req.headers["authorization"];
  if (!header || Array.isArray(header) || !header.startsWith("Bearer ")) return null;
  try {
    const secret = process.env.TRUERATE_JWT_SECRET;
    if (!secret) throw new Error("TRUERATE_JWT_SECRET not set");
    const payload = (await verify(header.slice(7), secret, "HS256")) as { sub: string };
    return payload.sub;
  } catch {
    return null;
  }
}

async function userIdFromUrlToken(token: string): Promise<string | null> {
  const repo = await getUserRepo();
  const user = await repo.getByMcpTokenHash(hashMcpToken(token));
  if (!user?.mcpToken) return null;
  // Best-effort lastUsedAt refresh, throttled to ~once/hour so we don't write
  // to the DB on every request. Never block or fail the request on this.
  const last = user.mcpToken.lastUsedAt;
  if (!last || Date.now() - Date.parse(last) > 3_600_000) {
    user.mcpToken.lastUsedAt = new Date().toISOString();
    try {
      await repo.update(user);
    } catch {
      /* non-fatal */
    }
  }
  return user.id;
}

// /u/<token>/mcp -> token. base64url tokens are [A-Za-z0-9_-].
const URL_TOKEN_RE = /^\/u\/([A-Za-z0-9_-]+)\/mcp$/;

/** The node:http request listener for the MCP server (routing + auth + tools). */
export function createRequestListener(): (
  req: IncomingMessage,
  res: ServerResponse,
) => Promise<void> {
  return async (req, res) => {
    const path = (req.url ?? "").split("?")[0] ?? "";

    if (req.method === "GET" && path === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, mode: engine.mode }));
      return;
    }

    const tokenMatch = URL_TOKEN_RE.exec(path);
    const isBearerMcp = path === "/mcp";
    if (!tokenMatch && !isBearerMcp) {
      res.writeHead(404).end();
      return;
    }

    const rawCid = req.headers["x-correlation-id"];
    const correlationId =
      (Array.isArray(rawCid) ? rawCid[0] : rawCid) ?? generateCorrelationId();
    const reqLog = log.child({ correlationId });

    const userId = tokenMatch
      ? await userIdFromUrlToken(tokenMatch[1]!)
      : await userIdFromBearer(req);

    if (!userId) {
      reqLog.warn("mcp request rejected: missing or invalid credential", {
        via: tokenMatch ? "url-token" : "bearer",
      });
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          error: tokenMatch
            ? "Invalid or revoked MCP URL. Generate a new one in the TrueRate app."
            : "Connect TrueRate with a valid bearer token.",
        }),
      );
      return;
    }

    const rlResult = mcpLimiter.check(`uid:${userId}`);
    const maxRequests = Number(process.env.RATE_LIMIT_MAX ?? 30);
    const resetSec = Math.ceil(rlResult.resetMs / 1000);
    res.setHeader("X-RateLimit-Limit", String(maxRequests));
    res.setHeader("X-RateLimit-Remaining", String(rlResult.remaining));
    res.setHeader("X-RateLimit-Reset", String(resetSec));
    if (!rlResult.allowed) {
      reqLog.warn("mcp request rate limited", { userId });
      res.setHeader("Retry-After", String(Math.ceil((rlResult.resetMs - Date.now()) / 1000)));
      res.writeHead(429, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "rate_limit_exceeded", retryAfter: resetSec }));
      return;
    }

    reqLog.info("mcp request", { method: req.method });

    const chunks: Buffer[] = [];
    for await (const ch of req) chunks.push(ch as Buffer);
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : undefined;

    const server = buildServer(userId, correlationId);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on("close", () => {
      transport.close();
      server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, body);
    res.setHeader("x-correlation-id", correlationId);
  };
}
