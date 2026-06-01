import { serve } from "@hono/node-server";
import { createLogger } from "@truerate/core";
import { app, engine } from "./app.js";

const log = createLogger({ service: "api" });
const port = Number(process.env.API_PORT ?? 8787);
serve({ fetch: app.fetch, port }, (info) => {
  log.info("server started", { port: info.port, enrichmentMode: engine.mode });
});
