import { setupTelemetry } from "@truerate/core";
// Must be called before any other imports so HTTP instrumentation registers first.
setupTelemetry("truerate-mcp");

import { createServer } from "node:http";
import { createLogger } from "@truerate/core";
import { createRequestListener } from "./http.js";
import { engine } from "./server.js";

// TrueRate MCP server — HTTP entrypoint.
//
// The surface that lets an AI assistant (Claude, ChatGPT, …) answer "find me a
// hotel in Vienna next weekend" with the user's actual membership benefits
// instead of generic public prices. Routing, auth, and tools live in http.ts;
// this file just listens and (in dev) seeds a demo user.
//
// AUTH: a per-user MCP URL (/u/<token>/mcp, #82) or an Authorization bearer JWT.
// Tokens/credentials never leave the server; membership secrets stay encrypted.

const startupLog = createLogger({ service: "mcp" });
const port = Number(process.env.MCP_PORT ?? 8788);
const httpServer = createServer(createRequestListener());

httpServer.listen(port, async () => {
  startupLog.info("server started", { port, enrichmentMode: engine.mode, endpoint: "/mcp" });

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
