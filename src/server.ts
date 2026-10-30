import { Hono } from "hono";
import { serveStatic } from "hono/bun";
import { existsSync } from "node:fs";
import { api } from "./api/routes";
import { config } from "./config";
import { openDb } from "./db";
import { activeModel, startWorker } from "./reviewer/worker";

openDb();

const app = new Hono();
const base = config.base;

app.route(`${base}/api`, api);

// Built dashboard. Everything that is not a file falls back to index.html so
// the History router can own the path.
const dist = new URL("../web/dist/", import.meta.url).pathname;
if (existsSync(`${dist}index.html`)) {
  app.use(`${base}/*`, serveStatic({ root: dist, rewriteRequestPath: (p) => p.slice(base.length) || "/" }));
  app.get(`${base}/*`, async (c) => {
    const html = await Bun.file(`${dist}index.html`).text();
    return c.html(html, 200, { "cache-control": "no-cache" });
  });
} else {
  app.get(`${base}/*`, (c) => c.text("Dashboard not built yet. Run `bun run build`.", 503));
}
app.get("/", (c) => c.redirect(`${base}/`));

app.onError((err, c) => {
  console.error(`[server] ${c.req.method} ${c.req.path}:`, err);
  return c.json({ error: err instanceof Error ? err.message : "Something went wrong." }, 500);
});

startWorker();

Bun.serve({ hostname: config.host, port: config.port, fetch: app.fetch, idleTimeout: 120 });
console.log(`gauntlet listening on http://${config.host}:${config.port}${base}/ (model: ${activeModel().name}, db: ${config.dbPath})`);
