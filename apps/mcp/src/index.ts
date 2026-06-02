import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { verify } from "hono/jwt";
import { createLogger, generateCorrelationId } from "@truerate/core";
import { buildServer, engine } from "./server.js";
import { mcpLimiter } from "./rate-limit.js";

const startupLog = createLogger({ service: "mcp" });

// TrueRate MCP server — HTTP wiring.
//
// This is the surface that lets an AI assistant (Claude, ChatGPT, etc.) answer
// "find me a hotel in Vienna next weekend" with the user's actual membership
// rates instead of generic public prices.
//
// AUTH MODEL
//   The user connects this MCP server with their TrueRate token as a bearer
//   header (the same JWT the web app issues). We verify it per request and act
//   as that user. Tokens carry no secrets — membership credentials stay in the
//   encrypted store and never leave the server.
//
// TRANSPORT
//   Streamable HTTP in STATELESS mode: a fresh server+transport per request,
//   no session map to maintain, so there is no need for Redis or sticky
//   sessions. This scales cleanly across Container App replicas.

async function userIdFromRequest(req: IncomingMessage): Promise<string | null> {
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

const port = Number(process.env.MCP_PORT ?? 8788);

const httpServer = createServer(async (req: IncomingMessage, res: ServerResponse) => {
  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, mode: engine.mode }));
    return;
  }

  if (req.url !== "/mcp") {
    res.writeHead(404).end();
    return;
  }

  const correlationId = (Array.isArray(req.headers["x-correlation-id"])
    ? req.headers["x-correlation-id"][0]
    : req.headers["x-correlation-id"]) ?? generateCorrelationId();

  const reqLog = startupLog.child({ correlationId });

  const userId = await userIdFromRequest(req);
  if (!userId) {
    reqLog.warn("mcp request rejected: missing or invalid bearer token");
    res.writeHead(401, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Connect TrueRate with a valid bearer token." }));
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
  for await (const c of req) chunks.push(c as Buffer);
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
});

httpServer.listen(port, async () => {
  startupLog.info("server started", { port, enrichmentMode: engine.mode, endpoint: `/mcp` });

  // Dev-only: seed dummy data into this process's store and print a ready token.
  if (process.env.TRUERATE_DEV_SEED === "true") {
    try {
      const { seedDevUser } = await import("./seed.js");
      const token = await seedDevUser();
      startupLog.info("dev seed loaded", {
        user: "demo@truerate.dev",
        memberships: ["Booking Genius L3", "Marriott Platinum", "Hilton Gold", "Revolut Metal", "Hotel PECR 15%"],
        endpoint: `http://localhost:${port}/mcp`,
        bearerToken: token,
      });
    } catch (err) {
      startupLog.error("dev seed failed", { error: err instanceof Error ? err.message : String(err) });
    }
  }
});
