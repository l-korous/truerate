import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { verify } from "hono/jwt";
import { buildServer, engine } from "./server.js";

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

  const userId = await userIdFromRequest(req);
  if (!userId) {
    res.writeHead(401, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Connect TrueRate with a valid bearer token." }));
    return;
  }

  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : undefined;

  const server = buildServer(userId);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on("close", () => {
    transport.close();
    server.close();
  });
  await server.connect(transport);
  await transport.handleRequest(req, res, body);
});

httpServer.listen(port, () => {
  console.log(`[mcp] TrueRate MCP on :${port}/mcp (enrichment mode: ${engine.mode})`);
});
