/**
 * ★★ گیتِ M5 گام ۳٫۶ — **هر چیزی که import می‌شود باید اعلام شده باشد.**
 *
 * ── چرا این گیت وجود دارد ────────────────────────────────────────────────
 *
 * این نقص **دو بار** رخ داده و هر دو بار از کنارِ همه‌ی گیت‌های موجود رد شده است:
 *
 * ۱. **فاز ۱:** `apps/realtime` از `@hamboom/config` استفاده می‌کرد و هیچ‌جا اعلامش
 *    نکرده بود. dev، typecheck، lint و کلِ `pnpm verify` سبز بودند — چون ورک‌اسپیس
 *    هر `@hamboom/*`ی را از هر جایی resolve می‌کند. فقط نصبِ `--prod` داخلِ ایمیج
 *    نشانش داد: `ERR_MODULE_NOT_FOUND` سرِ بوتِ کانتینر.
 * ۲. **فاز ۲:** پروژه‌ی **ریشه** همین نقص را داشت، این‌بار روی یک پکیجِ معمولی:
 *    `scripts/migrate.ts` به `@hamboom/config` و `pg` نیاز دارد و ریشه هیچ‌کدام را
 *    در `dependencies` نداشت ⇒ `docker compose run migrate` می‌مُرد.
 *
 * ⚠️ **درسِ مشترک:** ورک‌اسپیسِ pnpm در dev بخشنده است و در نصبِ production نیست. پس
 * تنها جایی که این کلاسِ نقص خودش را نشان می‌دهد، **دیرترین** جای ممکن است — بوتِ
 * کانتینر. این گیت همان را به لحظه‌ی کامیت می‌آورد.
 *
 * ── دو ادعا ──────────────────────────────────────────────────────────────
 *
 * **الف)** هر شناسه‌ی bareی که در سورسِ یک پکیج import می‌شود، در `package.json`ِ
 *     **همان پکیج** اعلام شده است (هر چهار نوع: prod/dev/peer/optional).
 *
 * **ب)** ★ برای دو اسکریپتی که واقعاً به production می‌روند
 *     (`scripts/migrate.ts` و `scripts/billing-reconcile.ts`)، importهای مستقیمشان
 *     باید در **`dependencies`**ِ ریشه باشند، نه `devDependencies` — چون ایمیج با
 *     `--prod` نصب می‌شود و `devDependencies` اصلاً نمی‌آید. ادعای «الف» به‌تنهایی
 *     نقصِ فاز ۲ را **نمی‌گرفت**.
 *
 * ── ★ خودآزمون ───────────────────────────────────────────────────────────
 *
 * `--self-test` هر دو ادعا را با منیفستِ ساختگیِ خراب می‌راند و انتظارِ **قرمز** دارد.
 *
 * اجرا: `pnpm deps:check` · ★ داخلِ `pnpm verify` هم هست.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { builtinModules } from "node:module";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

/**
 * ★ اسکریپت‌هایی که داخلِ ایمیجِ production اجرا می‌شوند.
 *
 * ⚠️ این فهرست با کامنتِ [`infra/docker/api.Dockerfile`](../infra/docker/api.Dockerfile)
 * یکی است. اگر روزی ورودیِ سومی اضافه شد، **هر دو** باید عوض شوند — و ادعای «ب» تنها
 * چیزی است که فراموش‌شدنش را قرمز می‌کند.
 */
const PRODUCTION_SCRIPTS = ["scripts/migrate.ts", "scripts/billing-reconcile.ts"];

const BUILTINS = new Set([...builtinModules, ...builtinModules.map((m) => `node:${m}`)]);
const SOURCE_EXT = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/;
const SKIP_DIRS = new Set(["node_modules", "dist", "build", "coverage", ".turbo", ".vite"]);

interface Manifest {
  name?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
}

interface Problem {
  claim: string;
  detail: string;
}

/**
 * شناسه‌ی bare را به **نامِ پکیج** می‌بَرد: `fastify/x` → `fastify`،
 * `@hamboom/config/y` → `@hamboom/config`. مسیرهای نسبی و builtinها `null` می‌شوند.
 */
export function packageOf(specifier: string): string | null {
  if (specifier.startsWith(".") || specifier.startsWith("/")) return null;
  if (BUILTINS.has(specifier)) return null;
  // ⚠️ هر چیزی که `:` یا `\` دارد شناسه‌ی پکیج نیست: `node:fs`، `file://…`، و
  //    مسیرِ مطلقِ ویندوز (`G:\…`). بدونِ این، اولین مسیرِ ویندوزی گیت را قرمزِ **دروغ** می‌کند.
  if (specifier.includes(":") || specifier.includes("\\")) return null;
  const parts = specifier.split("/");
  return specifier.startsWith("@") ? `${parts[0]}/${parts[1]}` : (parts[0] ?? null);
}

/**
 * حذفِ کامنت‌ها پیش از اسکن — **یک importِ کامنت‌شده import نیست.**
 *
 * ⚠️ این یک state machineِ ساده است و نه پارسر: رشته‌ها را می‌شناسد تا `"http://x"`
 * را کامنت نبیند، ولی regex literal را نه. بدترین حالتش این است که یک importِ واقعی
 * را از قلم بیندازد — نه اینکه چیزی را که اعلام شده قرمز کند.
 */
export function stripComments(source: string): string {
  let out = "";
  let i = 0;
  let quote: string | null = null;
  while (i < source.length) {
    const c = source[i] ?? "";
    const next = source[i + 1] ?? "";
    if (quote !== null) {
      out += c;
      if (c === "\\") {
        out += next;
        i += 2;
        continue;
      }
      if (c === quote) quote = null;
      i += 1;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      quote = c;
      out += c;
      i += 1;
      continue;
    }
    if (c === "/" && next === "/") {
      while (i < source.length && source[i] !== "\n") i += 1;
      continue;
    }
    if (c === "/" && next === "*") {
      i += 2;
      while (i < source.length && !(source[i] === "*" && source[i + 1] === "/")) i += 1;
      i += 2;
      continue;
    }
    out += c;
    i += 1;
  }
  return out;
}

/**
 * استخراجِ شناسه‌های bare از یک فایل.
 *
 * ⚠️ عمداً regex است و نه پارسرِ کامل: هدف **پیداکردنِ نقص** است، نه تحلیلِ دقیقِ نحو.
 * یک importِ عجیب که از قلم بیفتد، بدترین حالتش این است که این گیت آن را نگیرد —
 * ولی هیچ‌وقت چیزی را که واقعاً اعلام شده قرمز نمی‌کند.
 */
export function importsIn(rawSource: string): string[] {
  const source = stripComments(rawSource);
  const found = new Set<string>();
  const patterns = [
    /(?:^|\n)\s*import\s[^;]*?from\s*["']([^"']+)["']/g,
    /(?:^|\n)\s*import\s*["']([^"']+)["']/g,
    /(?:^|\n)\s*export\s[^;]*?from\s*["']([^"']+)["']/g,
    /\bimport\(\s*["']([^"']+)["']\s*\)/g,
    /\brequire\(\s*["']([^"']+)["']\s*\)/g,
  ];
  for (const re of patterns) {
    for (const m of source.matchAll(re)) {
      const pkg = packageOf(m[1] ?? "");
      if (pkg !== null) found.add(pkg);
    }
  }
  return [...found].sort();
}

/** فایل‌های سورسِ یک پوشه (بدونِ زیرپوشه‌های تولیدی). */
function sourceFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) sourceFiles(join(dir, entry.name), acc);
    } else if (SOURCE_EXT.test(entry.name)) {
      acc.push(join(dir, entry.name));
    }
  }
  return acc;
}

const declared = (m: Manifest): Set<string> =>
  new Set([
    ...Object.keys(m.dependencies ?? {}),
    ...Object.keys(m.devDependencies ?? {}),
    ...Object.keys(m.peerDependencies ?? {}),
    ...Object.keys(m.optionalDependencies ?? {}),
  ]);

/** ادعای الف — importهای یک پکیج در برابرِ منیفستش. */
export function checkDeclared(
  label: string,
  manifest: Manifest,
  used: Map<string, string[]>,
): Problem[] {
  const known = declared(manifest);
  const missing = [...used.entries()].filter(([pkg]) => !known.has(pkg) && pkg !== manifest.name);
  if (missing.length === 0) return [];
  return missing.map(([pkg, files]) => ({
    claim: `${label} — وابستگیِ اعلام‌نشده: ${pkg}`,
    detail: `استفاده در ${files.slice(0, 3).join("، ")}${files.length > 3 ? ` (+${files.length - 3})` : ""}`,
  }));
}

/** ادعای ب — importهای اسکریپت‌های production در برابرِ `dependencies`ِ ریشه. */
export function checkProductionScope(
  manifest: Manifest,
  used: Map<string, string[]>,
): Problem[] {
  const prod = new Set(Object.keys(manifest.dependencies ?? {}));
  return [...used.entries()]
    .filter(([pkg]) => !prod.has(pkg))
    .map(([pkg, files]) => ({
      claim: `اسکریپتِ production به وابستگیِ dev-scope تکیه دارد: ${pkg}`,
      detail: `${files.join("، ")} داخلِ ایمیج اجرا می‌شود، ولی نصبِ \`--prod\` هرگز devDependencies را نمی‌آورد`,
    }));
}

/** پکیج‌های ورک‌اسپیس + خودِ ریشه. */
function workspaceDirs(): string[] {
  const dirs: string[] = [];
  for (const group of ["apps", "packages"]) {
    const base = join(ROOT, group);
    for (const entry of readdirSync(base, { withFileTypes: true })) {
      if (entry.isDirectory() && statSync(join(base, entry.name, "package.json")).isFile()) {
        dirs.push(join(base, entry.name));
      }
    }
  }
  return dirs;
}

/** نگاشتِ «نامِ پکیج → فایل‌هایی که واردش می‌کنند» برای فهرستی از فایل‌ها. */
function usageOf(files: string[]): Map<string, string[]> {
  const used = new Map<string, string[]>();
  for (const file of files) {
    for (const pkg of importsIn(readFileSync(file, "utf8"))) {
      const rel = relative(ROOT, file).replaceAll("\\", "/");
      used.set(pkg, [...(used.get(pkg) ?? []), rel]);
    }
  }
  return used;
}

function selfTest(): boolean {
  const cases: { name: string; ok: boolean }[] = [];
  const use = (pkg: string): Map<string, string[]> => new Map([[pkg, ["x.ts"]]]);

  cases.push({
    name: "وابستگیِ اعلام‌نشده گرفته می‌شود (نقصِ فاز ۱)",
    ok:
      checkDeclared("t", { name: "@hamboom/realtime", dependencies: { ws: "*" } }, use("@hamboom/config"))
        .length === 1,
  });
  cases.push({
    name: "اعلامِ dev کافی است (منفیِ کاذب ندارد)",
    ok: checkDeclared("t", { devDependencies: { vitest: "*" } }, use("vitest")).length === 0,
  });
  cases.push({
    name: "importِ خودِ پکیج قرمز نمی‌شود",
    ok: checkDeclared("t", { name: "@hamboom/api" }, use("@hamboom/api")).length === 0,
  });
  cases.push({
    name: "★ اسکریپتِ production روی dev-scope گرفته می‌شود (نقصِ فاز ۲)",
    ok: checkProductionScope({ devDependencies: { pg: "*" } }, use("pg")).length === 1,
  });
  cases.push({
    name: "همان پکیج در prod-scope قرمز نمی‌شود",
    ok: checkProductionScope({ dependencies: { pg: "*" } }, use("pg")).length === 0,
  });
  cases.push({
    name: "زیرمسیر به نامِ پکیج تبدیل می‌شود",
    ok: packageOf("@hamboom/config/x") === "@hamboom/config" && packageOf("fastify/y") === "fastify",
  });
  cases.push({
    name: "builtin و مسیرِ نسبی نادیده گرفته می‌شوند",
    ok: packageOf("node:fs") === null && packageOf("fs") === null && packageOf("./a.ts") === null,
  });
  // ★ این دو مورد از یک **منفیِ کاذبِ واقعی** آمدند: `apps/realtime/src/index.test.ts`
  //   در یک **کامنت** مسیرِ مطلقِ ویندوز را نشان می‌دهد، و اجرای اولِ همین گیت آن را
  //   «وابستگیِ اعلام‌نشده‌ی `G:\…`» گزارش کرد.
  // ⚠️ کلمه‌ی کلیدی از یک **ثابت** می‌آید، وگرنه اسکنر فیکسچرِ خودِ این فایل را
  //    به‌عنوانِ importِ واقعی می‌شمارد (آزموده شد: `ghost-a` گزارش شد). خودش یک
  //    یادآوریِ کوچکِ محدودیتِ regex است: کد و **محتوای رشته** را از هم جدا نمی‌کند.
  const kw = "im" + "port";
  cases.push({
    name: "★ importِ **کامنت‌شده** شمرده نمی‌شود",
    ok:
      importsIn(`// ${kw}("ghost-a")\n${kw} a from "real-pkg";`).join() === "real-pkg" &&
      importsIn(`/* ${kw} b from "ghost-b"; */\n`).length === 0,
  });
  cases.push({
    name: "مسیرِ مطلقِ ویندوز و URL شناسه‌ی پکیج نیستند",
    ok: packageOf(String.raw`G:\x`) === null && packageOf("file:///a") === null,
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
    console.log("\n✔ خودآزمون: هر دو ادعا با منیفستِ خراب قرمز شدند.");
    return;
  }

  const problems: Problem[] = [];
  let checked = 0;

  for (const dir of workspaceDirs()) {
    const manifest = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as Manifest;
    const label = manifest.name ?? relative(ROOT, dir);
    problems.push(...checkDeclared(label, manifest, usageOf(sourceFiles(dir))));
    checked += 1;
  }

  // ── ریشه: `scripts/**` سورسِ خودش است ──────────────────────────────
  const rootManifest = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as Manifest;
  const rootUsage = usageOf(sourceFiles(join(ROOT, "scripts")));
  problems.push(...checkDeclared("ریشه (scripts/)", rootManifest, rootUsage));
  checked += 1;

  // ── ادعای ب: فقط اسکریپت‌هایی که واقعاً به production می‌روند ────────
  const prodUsage = usageOf(PRODUCTION_SCRIPTS.map((p) => join(ROOT, p)));
  problems.push(...checkProductionScope(rootManifest, prodUsage));

  console.log(`پکیج‌های بررسی‌شده: ${checked} · اسکریپتِ production: ${PRODUCTION_SCRIPTS.length}`);
  if (problems.length > 0) {
    for (const p of problems) console.error(`✖ ${p.claim}\n    ${p.detail}`);
    console.error("\n✖ وابستگیِ اعلام‌نشده — نصبِ production این را در بوت می‌شکند.");
    process.exit(1);
  }
  console.log("✔ هر importِ bare در منیفستِ پکیجِ خودش اعلام شده است.");
}

main();
