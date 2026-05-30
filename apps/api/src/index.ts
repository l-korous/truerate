import { serve } from "@hono/node-server";
import { app, engine } from "./app.js";

const port = Number(process.env.API_PORT ?? 8787);
serve({ fetch: app.fetch, port }, (info) => {
  console.log(`[api] listening on :${info.port} (enrichment mode: ${engine.mode})`);
});
