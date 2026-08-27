import type { FastifyInstance } from "fastify";

import { buildOpenApiDocument } from "../openapi.ts";

/**
 * سرویسِ سندِ OpenAPI + یک مرورگرِ سبکِ **self-hosted** — گام ۵٫۵.
 *
 * ★ P2: هیچ CDN/اسکریپتِ خارجی. مرورگر یک صفحه‌ی کوچکِ درون‌خطی است که `/openapi.json` را
 * می‌گیرد و endpointها را گروه‌بندی‌شده نشان می‌دهد (نه Swagger-UIِ سنگین). هر دو عمومی‌اند.
 */

const DOCS_HTML = `<!doctype html>
<html lang="fa" dir="rtl">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Hamboom API</title>
<style>
  :root { color-scheme: light dark; }
  body { font-family: system-ui, "Segoe UI", Tahoma, sans-serif; margin: 0; padding: 1.5rem;
         max-width: 60rem; margin-inline: auto; line-height: 1.6; }
  h1 { margin-block: 0 .25rem; } .sub { opacity: .7; margin-block: 0 1.5rem; }
  h2 { margin-block: 1.75rem .5rem; border-block-end: 1px solid #8884; padding-block-end: .25rem;
       text-transform: uppercase; font-size: .8rem; letter-spacing: .05em; opacity: .8; }
  .row { display: flex; gap: .75rem; align-items: baseline; padding-block: .3rem;
         border-block-end: 1px solid #8882; flex-wrap: wrap; }
  .m { font-weight: 700; font-size: .72rem; padding: .1rem .45rem; border-radius: .35rem;
       min-width: 3.5rem; text-align: center; color: #fff; }
  .get{background:#2563eb}.post{background:#16a34a}.patch{background:#d97706}
  .delete{background:#dc2626}.put{background:#7c3aed}
  code { font-family: ui-monospace, monospace; direction: ltr; unicode-bidi: bidi-override; }
  .p { font-weight: 600; } .s { opacity: .75; font-size: .92rem; }
  .lock { font-size: .8rem; opacity: .6; }
</style>
</head>
<body>
<h1>Hamboom API</h1>
<p class="sub">OpenAPI 3.1 · منبع: <code>/openapi.json</code></p>
<div id="app">در حالِ بارگذاری…</div>
<script>
(async () => {
  const el = document.getElementById("app");
  try {
    const doc = await (await fetch("/openapi.json")).json();
    const byTag = {};
    for (const [path, methods] of Object.entries(doc.paths)) {
      for (const [method, op] of Object.entries(methods)) {
        const tag = (op.tags && op.tags[0]) || "other";
        (byTag[tag] ??= []).push({ method, path, op });
      }
    }
    el.innerHTML = "";
    for (const tag of Object.keys(byTag)) {
      const h = document.createElement("h2"); h.textContent = tag; el.appendChild(h);
      for (const { method, path, op } of byTag[tag]) {
        const row = document.createElement("div"); row.className = "row";
        const secured = op.security ? '<span class="lock" title="نیاز به Bearer">🔒</span>' : "";
        row.innerHTML = '<span class="m ' + method + '">' + method.toUpperCase() + '</span>' +
          '<code class="p">' + path + '</code>' + secured +
          '<span class="s">' + (op.summary || "") + '</span>';
        el.appendChild(row);
      }
    }
  } catch (e) {
    el.textContent = "بارگذاریِ /openapi.json ناموفق بود: " + e;
  }
})();
</script>
</body>
</html>`;

export function registerDocsRoutes(app: FastifyInstance): void {
  // سند یک‌بار ساخته می‌شود (تغییرناپذیر در طولِ عمرِ فرایند).
  const document = buildOpenApiDocument();
  app.get("/openapi.json", () => document);
  app.get("/api/v1/docs", (_req, reply) => reply.type("text/html").send(DOCS_HTML));
}
