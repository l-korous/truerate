import { serve } from "@hono/node-server";
import { createLogger } from "@truerate/core";
import { app, engine } from "./app.js";

const log = createLogger({ service: "api" });

// Process-level safety net: an uncaught exception or unhandled rejection (e.g.
// from a SDK callback) would otherwise crash the replica mid-request, dropping
// the connection so the ingress returns a bare text/plain 500 with NO log —
// undiagnosable. Log them with full detail and keep the process alive.
function logFatal(kind: string, err: unknown): void {
  const e = err as { name?: string; message?: string; code?: unknown; stack?: string };
  log.error(kind, {
    name: e?.name,
    message: e?.message ?? String(err),
    code: e?.code,
    stack: e?.stack?.split("\n").slice(0, 10).join(" | "),
  });
}
process.on("uncaughtException", (err) => logFatal("uncaughtException", err));
process.on("unhandledRejection", (reason) => logFatal("unhandledRejection", reason));

const port = Number(process.env.API_PORT ?? 8787);
serve({ fetch: app.fetch, port }, (info) => {
  log.info("server started", { port: info.port, enrichmentMode: engine.mode });
});
