/**
 * ★★ گیتِ اصلِ P2 — M5 گام ۹٫۳: **صفر فراخوانیِ خارجی در runtime** جز سرویس‌های ایرانیِ
 * تصمیم‌گرفته‌شده (زرین‌پال — ADR-014، sms.ir — فازِ ۴٫۵).
 *
 * ```bash
 * node scripts/check-p2.ts              # ممیزی — داخلِ pnpm verify
 * node scripts/check-p2.ts --self-test  # هفت شکستنِ عمدی روی سورسِ ساختگی
 * ```
 *
 * ── چرا گیت و نه یک grepِ دستی ────────────────────────────────────────────
 *
 * معیارِ پذیرشِ گام ۹٫۳ «با grep روی سورس اثبات شود» بود. یک grep که یک بار اجرا شود
 * همان `lint:css`ِ هیچ‌وقت-اجرانشده است: روزی که کسی برای یک آیکون `<link href="https://fonts.googleapis.com…">`
 * به `index.html` اضافه کند، هیچ‌چیز قرمز نمی‌شود — تا کاربری در ایران با یک صفحه‌ی
 * بی‌فونتِ ۲۰ثانیه‌ای مواجه شود. پس همان grep این‌جا **هر بار** اجرا می‌شود، با فهرستِ
 * مجازِ **دلیل‌دار**، و استثنایی که دیگر مصداق ندارد قرمز می‌شود (الگوی گیتِ پروکسی).
 *
 * ── چه چیزی می‌بیند و چه چیزی نمی‌بیند ──────────────────────────────────
 *
 * می‌بیند: هر `http(s)://host` و `ws(s)://host` در **کدِ** runtime (`apps/*\/src`،
 * `packages/*\/src`، `apps/web/index.html`)، و `//host` protocol-relative در HTML/CSS.
 * کامنت‌ها **شمرده نمی‌شوند** (کامنتِ «فرمولِ WCAG در w3.org» فراخوانی نیست).
 *
 * ⚠️ نمی‌بیند: میزبانی که در **وابستگی** پخته شده (مثلِ CDNِ پیش‌فرضِ Excalidraw که در
 * `asset-path.ts` بازنویسی می‌شود)، و URLی که از تکه‌ها ساخته می‌شود. اولی را ممیزیِ
 * شبکه‌ی مرورگر روی باندلِ واقعی می‌گیرد (PROGRESS، گام ۹٫۳)، دومی را کدِ خودمان نمی‌نویسد.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { stripComments } from "./source-text.ts";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

/** میزبان‌های مجاز — هرکدام با دلیل. ★ استثنای بی‌مصداق قرمز می‌شود (پایین). */
export const ALLOWED_HOSTS: readonly { host: RegExp; reason: string }[] = [
  {
    host: /^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])$/,
    reason: "لوکال — پیش‌فرض‌های توسعه (P3)",
  },
  {
    host: /^([a-z0-9-]+\.)?zarinpal\.com$/,
    reason: "درگاهِ پرداختِ ایرانی — ADR-014، تنها فراخوانیِ خارجیِ PLAN",
  },
  { host: /^api\.sms\.ir$/, reason: "سرویسِ پیامکِ ایرانی — M5 فازِ ۴٫۵" },
];

const SKIP_DIRS = new Set([
  "node_modules",
  "dist",
  "dev",
  "coverage",
  ".turbo",
  "e2e",
  "__tests__",
  "excalidraw-assets",
]);
const SKIP_FILE = /\.(test|spec)\.(ts|tsx|mts)$|test-fixtures\.ts$|\.d\.ts$/;
const SOURCE_EXT = /\.(ts|tsx|mts|css|html)$/;

export interface Hit {
  file: string;
  line: number;
  host: string;
}

/**
 * حذفِ کامنت بر اساسِ نوعِ فایل.
 *
 * ⚠️ CSS و HTML **نباید** از `stripComments` رد شوند: آن تابع `//` را کامنتِ خطی می‌گیرد
 * و یک `url(//fonts.gstatic.com/…)` را — که دقیقاً چیزی است که دنبالش می‌گردیم — پاک می‌کند.
 * خودآزمونِ ۴ همین را می‌سنجد.
 */
export function stripByType(file: string, source: string): string {
  if (file.endsWith(".css")) return source.replace(/\/\*[\s\S]*?\*\//g, "");
  if (file.endsWith(".html")) return source.replace(/<!--[\s\S]*?-->/g, "");
  return stripComments(source);
}

const ABSOLUTE = /\b(?:https?|wss?):\/\/([a-z0-9.-]+|\[[0-9a-f:]+\])(?::\d+)?/gi;
/** protocol-relative — فقط جایی که مرورگر واقعاً fetch می‌کند: `src=`/`href=`/`url(`. */
const RELATIVE = /(?:\b(?:src|href)\s*=\s*["']|url\(\s*["']?)\/\/([a-z0-9.-]+)(?::\d+)?/gi;

/** میزبان‌های یک فایل، با شماره‌ی خط — روی متنِ **بدونِ کامنت**. */
export function scanSource(file: string, raw: string): Hit[] {
  const stripped = stripByType(file, raw);
  const hits: Hit[] = [];
  const lines = stripped.split("\n");
  for (const [index, line] of lines.entries()) {
    for (const re of [ABSOLUTE, RELATIVE]) {
      for (const m of line.matchAll(re)) {
        hits.push({ file, line: index + 1, host: (m[1] ?? "").toLowerCase() });
      }
    }
  }
  return hits;
}

export interface Audit {
  violations: Hit[];
  /** شمارشِ هر استثنای مجاز — برای گزارش، و برای گرفتنِ استثنای مرده. */
  allowedCounts: number[];
  files: number;
}

export function audit(
  sources: readonly { file: string; raw: string }[],
  allowed: readonly { host: RegExp; reason: string }[] = ALLOWED_HOSTS,
): Audit {
  const allowedCounts = allowed.map(() => 0);
  const violations: Hit[] = [];
  for (const { file, raw } of sources) {
    for (const hit of scanSource(file, raw)) {
      const idx = allowed.findIndex((a) => a.host.test(hit.host));
      if (idx === -1) violations.push(hit);
      else allowedCounts[idx] = (allowedCounts[idx] ?? 0) + 1;
    }
  }
  return { violations, allowedCounts, files: sources.length };
}

function walk(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) walk(join(dir, entry.name), acc);
    } else if (SOURCE_EXT.test(entry.name) && !SKIP_FILE.test(entry.name)) {
      acc.push(join(dir, entry.name));
    }
  }
  return acc;
}

/** فایل‌های runtime: `src/`ِ هر اپ و پکیج + پوسته‌ی SPA. */
function runtimeFiles(): string[] {
  const files: string[] = [];
  for (const group of ["apps", "packages"]) {
    for (const entry of readdirSync(join(ROOT, group), { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const src = join(ROOT, group, entry.name, "src");
      try {
        walk(src, files);
      } catch {
        // پکیجِ بدونِ src (مثلِ tsconfig) — چیزی برای ممیزی ندارد.
      }
    }
  }
  const shell = join(ROOT, "apps", "web", "index.html");
  try {
    readFileSync(shell);
    files.push(shell);
  } catch {
    // بدونِ پوسته
  }
  return files;
}

function selfTest(): boolean {
  const allowed = ALLOWED_HOSTS;
  const cases: { name: string; ok: boolean }[] = [];
  const one = (file: string, raw: string) => audit([{ file, raw }], allowed).violations;

  cases.push({
    name: "★ فراخوانیِ خارجی در کد گرفته می‌شود (fonts.googleapis.com)",
    ok: one("a.ts", 'fetch("https://fonts.googleapis.com/css2?family=Vazirmatn");').some(
      (h) => h.host === "fonts.googleapis.com",
    ),
  });
  cases.push({
    name: "★ همان URL داخلِ کامنت شمرده نمی‌شود",
    ok:
      one("a.ts", '// fetch("https://fonts.googleapis.com/css")\nconst x = 1;').length === 0 &&
      one("a.ts", "/* https://fonts.googleapis.com */ const x = 1;").length === 0,
  });
  cases.push({
    name: "میزبانِ مجاز (sms.ir، زرین‌پال، لوکال) قرمز نمی‌شود",
    ok:
      one(
        "a.ts",
        'const a = "https://api.sms.ir/v1"; const b = "https://payment.zarinpal.com/pg"; const c = "http://localhost:3002";',
      ).length === 0,
  });
  cases.push({
    name: "★★ url(//host) در CSS گرفته می‌شود — و `//` آن‌جا کامنت نیست",
    ok: one("a.css", "@font-face { src: url(//fonts.gstatic.com/s/v.woff2); }").some(
      (h) => h.host === "fonts.gstatic.com",
    ),
  });
  cases.push({
    name: "★ <script src> خارجی در HTML گرفته می‌شود، داخلِ <!-- --> نه",
    ok:
      one("i.html", '<script src="https://cdn.tailwindcss.com"></script>').length === 1 &&
      one("i.html", '<!-- <script src="https://cdn.tailwindcss.com"></script> -->').length === 0,
  });
  cases.push({
    name: "★ WebSocketِ خارجی (wss://) گرفته می‌شود",
    ok: one("a.ts", 'new WebSocket("wss://rt.example.com/rt")').some(
      (h) => h.host === "rt.example.com",
    ),
  });
  cases.push({
    name: "★★ استثنای مرده گرفته می‌شود (میزبانِ مجازی که هیچ‌جا نیست)",
    ok: (() => {
      const result = audit(
        [{ file: "a.ts", raw: 'const a = "http://localhost";' }],
        [...allowed, { host: /^dead\.example$/, reason: "ساختگی" }],
      );
      return result.allowedCounts.at(-1) === 0;
    })(),
  });

  for (const c of cases) console.log(`${c.ok ? "✔" : "✖"} خودآزمون: ${c.name}`);
  return cases.every((c) => c.ok);
}

function main(): void {
  if (process.argv.includes("--self-test")) {
    if (!selfTest()) {
      console.error("\n✖ خودآزمون شکست — این گیت به خودش هم اعتماد ندارد.");
      process.exit(1);
    }
    console.log("\n✔ خودآزمون: هر هفت مورد درست است.");
    return;
  }

  const sources = runtimeFiles().map((file) => ({
    file: relative(ROOT, file).replace(/\\/g, "/"),
    raw: readFileSync(file, "utf8"),
  }));
  const result = audit(sources);

  const inventory = ALLOWED_HOSTS.map(
    (a, i) => `${a.reason.split(" — ")[0] ?? ""}: ${String(result.allowedCounts[i] ?? 0)}`,
  );
  console.log(`فایلِ runtime: ${String(result.files)} · میزبانِ مجاز → ${inventory.join(" · ")}`);

  const problems: string[] = [];
  for (const v of result.violations) {
    problems.push(`${v.file}:${String(v.line)} → ${v.host} (P2: سرویسِ خارجی در runtime)`);
  }
  // ★ استثنایی که دیگر مصداق ندارد: یا سرویس رفته (پس استثنا هم برود) یا اسکن کور شده.
  for (const [i, count] of result.allowedCounts.entries()) {
    if (count === 0) {
      problems.push(`استثنای مرده: «${ALLOWED_HOSTS[i]?.reason ?? ""}» هیچ مصداقی در سورس ندارد`);
    }
  }

  if (problems.length > 0) {
    for (const p of problems) console.error(`✖ ${p}`);
    console.error("\n✖ اصلِ P2 نقض شده یا فهرستِ مجاز کهنه است.");
    process.exit(1);
  }
  console.log("✔ P2: هیچ میزبانِ خارجی‌ای در کدِ runtime نیست جز زرین‌پال و sms.ir.");
}

main();
