/**
 * تولیدِ `docs/api.md` + `docs/openapi.json` از سندِ OpenAPIِ `apps/api` — گام ۵٫۵.
 *
 * منبعِ حقیقت zodِ `shared-types` + منیفستِ `apps/api/src/openapi.ts` است؛ این اسکریپت فقط آن را
 * به دو فایلِ ایستا می‌ریزد. سندِ **زنده** روی `GET /openapi.json` و `GET /api/v1/docs` است.
 *
 * ── ★★ گیتِ کهنگی (`--check`) — M5 گام ۳٫۳ ───────────────────────────────────
 *
 * ⚠️ در فاز ۱۰ی M4 معلوم شد `docs/openapi.json` **۶۶۴ خط** کهنه است: کلِ سطحِ billing از
 * فاز ۵ در سند نبود و **هیچ گیتی قرمز نشد**. گاردِ دریفتِ داخلِ اپ تمامِ آن مدت سبز بود،
 * چون آن **تعریفِ** OpenAPI را می‌سنجد نه **فایلِ تولیدشده** را — دو چیزِ متفاوت.
 *
 * `--check` همان دو فایل را می‌سازد و با نسخه‌ی کامیت‌شده مقایسه می‌کند. چون به هیچ
 * سرویسی نیاز ندارد و ~۱ ثانیه است، **داخلِ `pnpm verify`** نشست، نه فقط در CI —
 * وگرنه همان اشتباه است: گیتی که خودکار اجرا نشود، اجرا نمی‌شود.
 *
 * اجرا: `node scripts/gen-openapi.ts` · گیت: `node scripts/gen-openapi.ts --check`
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { buildOpenApiDocument } from "../apps/api/src/openapi.ts";

interface Operation {
  tags?: string[];
  summary?: string;
  security?: unknown[];
}
interface Doc {
  info: { title: string; version: string; description?: string };
  tags: { name: string }[];
  paths: Record<string, Record<string, Operation>>;
  components: { schemas: Record<string, unknown> };
}

const doc = buildOpenApiDocument() as unknown as Doc;
const METHODS = ["get", "post", "patch", "put", "delete"];

const lines: string[] = [];
lines.push(`# ${doc.info.title} — مرجعِ REST`);
lines.push("");
lines.push(
  "> ⚠️ این فایل **تولیدشده** است (`node scripts/gen-openapi.ts`). ویرایشِ دستی نکن — منبع: zodِ",
);
lines.push(
  "> `shared-types` + `apps/api/src/openapi.ts`. سندِ **زنده**: `GET /api/v1/docs` و `GET /openapi.json`.",
);
lines.push("");
lines.push(`نسخه: **${doc.info.version}** · OpenAPI **3.1** · ${doc.info.description ?? ""}`);
lines.push("");
lines.push(
  "**احراز:** endpointهای غیرعمومی به هدرِ `Authorization: Bearer <accessToken>` نیاز دارند. خطاها قالبِ یکسانِ `ApiError` دارند.",
);
lines.push("");

// گروه‌بندی بر اساسِ tag (به ترتیبِ اعلامِ tags).
for (const { name: tag } of doc.tags) {
  const rows: string[] = [];
  for (const [path, methods] of Object.entries(doc.paths)) {
    for (const method of METHODS) {
      const op = methods[method];
      if (!op || (op.tags?.[0] ?? "other") !== tag) continue;
      const auth = op.security ? "🔒 bearer" : "عمومی";
      rows.push(`| ${method.toUpperCase()} | \`${path}\` | ${auth} | ${op.summary ?? ""} |`);
    }
  }
  if (rows.length === 0) continue;
  lines.push(`## ${tag}`);
  lines.push("");
  lines.push("| متد | مسیر | احراز | توضیح |");
  lines.push("|---|---|---|---|");
  lines.push(...rows);
  lines.push("");
}

lines.push("## Schemas (`components`)");
lines.push("");
lines.push(
  "شکلِ کاملِ هر schema در [`docs/openapi.json`](openapi.json) است (تولیدشده از zod با `z.toJSONSchema`):",
);
lines.push("");
lines.push(
  Object.keys(doc.components.schemas)
    .map((s) => `\`${s}\``)
    .join(" · "),
);
lines.push("");

const docsDir = join(import.meta.dirname, "..", "docs");
const generated: [string, string][] = [
  ["api.md", `${lines.join("\n")}\n`],
  ["openapi.json", `${JSON.stringify(doc, null, 2)}\n`],
];

if (process.argv.includes("--check")) {
  // ★ `\r\n` نرمال می‌شود: `.gitattributes` همه‌چیز را LF نگه می‌دارد، ولی یک checkoutِ
  //   بدقلق روی ویندوز نباید گیت را با یک تفاوتِ **نامرئی** قرمز کند.
  const stale = generated.filter(
    ([name, content]) =>
      readFileSync(join(docsDir, name), "utf8").replace(/\r\n/g, "\n") !== content,
  );
  if (stale.length > 0) {
    console.error(`✖ سندِ تولیدشده کهنه است: ${stale.map(([n]) => `docs/${n}`).join("، ")}`);
    console.error("    بازتولید: pnpm openapi:gen");
    process.exit(1);
  }
  console.log("✔ docs/api.md و docs/openapi.json با تعریفِ زنده می‌خوانند.");
  process.exit(0);
}

for (const [name, content] of generated) writeFileSync(join(docsDir, name), content, "utf8");

const endpointCount = Object.values(doc.paths).reduce(
  (n, methods) => n + Object.keys(methods).length,
  0,
);
console.log(
  `نوشته شد: docs/api.md + docs/openapi.json (${endpointCount} endpoint، ${Object.keys(doc.components.schemas).length} schema)`,
);
