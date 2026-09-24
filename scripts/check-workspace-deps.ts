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
 * ── ★★ M6 فاز ۲٫۷: ادعای «ب» **بازگشتی** شد ──────────────────────────────
 *
 * تا M6 فقط importهای **مستقیمِ** فایل‌های `PRODUCTION_SCRIPTS` دیده می‌شدند؛ importِ نسبی
 * (`./restore-storage-core.ts`) نادیده گرفته می‌شد و دنبال نمی‌شد. یعنی یک اسکریپتِ production
 * می‌توانست از راهِ یک فایلِ کمکی به `yjs`ی که فقط `devDependency` بود برسد — CI (نصبِ کاملِ
 * dev) سبز، و بوتِ اسکریپت روی VM `ERR_MODULE_NOT_FOUND` (بازبینِ خصمانه‌ی نقشه‌ی M6 گرفتش).
 * حالا بستارِ importهای نسبی دنبال می‌شود و هر فایل به‌ازای **صاحبش** سنجیده می‌شود:
 *   • فایلِ `scripts/` ⇒ `dependencies`ِ ریشه؛
 *   • فایلِ داخلِ ورک‌اسپیسی که در ایمیجِ api نصب می‌شود (`apps/api` و بستارِ `workspace:*`ش +
 *     `dependencies`ِ ریشه) ⇒ `dependencies`ِ همان ورک‌اسپیس؛
 *   • فایلِ داخلِ ورک‌اسپیسی که در ایمیج **نیست** (`apps/realtime`، `apps/web`، …) ⇒ قرمز، هرچه
 *     import کند — چون خودِ آن فایل روی VM نیست.
 *
 * ── ★ خودآزمون ───────────────────────────────────────────────────────────
 *
 * `--self-test` هر دو ادعا را با منیفستِ ساختگیِ خراب می‌راند و انتظارِ **قرمز** دارد — از جمله
 * سه سناریوی بستارِ نسبی با یک فایل‌سیستمِ ساختگی.
 *
 * اجرا: `pnpm deps:check` · ★ داخلِ `pnpm verify` هم هست.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { builtinModules } from "node:module";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { stripComments } from "./source-text.ts";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

/**
 * ★ اسکریپت‌هایی که داخلِ ایمیجِ production اجرا می‌شوند.
 *
 * ⚠️ این فهرست با کامنتِ [`infra/docker/api.Dockerfile`](../infra/docker/api.Dockerfile)
 * یکی است. اگر روزی ورودیِ سومی اضافه شد، **هر دو** باید عوض شوند — و ادعای «ب» تنها
 * چیزی است که فراموش‌شدنش را قرمز می‌کند.
 */
const PRODUCTION_SCRIPTS = [
  "scripts/migrate.ts",
  "scripts/billing-reconcile.ts",
  // ★ M5 فاز ۷ — پشتیبان و **مشقِ بازیابی** روی خودِ VM اجرا می‌شوند، وگرنه فقط
  //   مکانیزم اثبات می‌شود نه پشتیبانِ واقعی.
  "scripts/backup-db.ts",
  "scripts/backup-storage.ts",
  "scripts/restore-drill.ts",
  // فایل‌های کمکی که همان‌جا بارگذاری می‌شوند (importِ نسبی، ولی importهای bareشان
  // در همان نصبِ `--prod` resolve می‌شوند).
  "scripts/backup-common.ts",
  "scripts/pg-tools.ts",
  // ⚠️ مشقِ بازیابی این را **spawn** می‌کند؛ پس این هم داخلِ ایمیج اجرا می‌شود.
  "scripts/db-fk-test.ts",
  // ★ M5 فاز ۸ — نگهداشت و پاک‌سازی، از cronِ همان VM.
  "scripts/sweep-orphans.ts",
  "scripts/sweep-orphans-core.ts",
  "scripts/purge-deleted.ts",
  // ★ M6 فاز ۲ — پشتیبانِ جفت و **بازیابیِ Object Storage**؛ خودآزمون‌ها هم از داخلِ ایمیج اجرا
  //   می‌شوند (images.yml) تا «ایمیج می‌تواند بارشان کند» ادعا نباشد.
  "scripts/backup-all.ts",
  "scripts/backup-run.ts",
  "scripts/backup-storage.self-test.ts",
  "scripts/restore-storage.ts",
  "scripts/restore-storage-core.ts",
  "scripts/restore-storage.self-test.ts",
  // ★ M6 فاز ۳ — تنها نویسنده‌ی `is_staff` (ADR-066 §۲)، از داخلِ ایمیج با compose `grant-staff`.
  "scripts/admin-grant-staff.ts",
  // ★ M6 فاز ۴ — نگهداشتِ audit_logs (ADR-067 §۴)، cronِ ماهانه از همان VM.
  "scripts/purge-audit.ts",
];

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

/** شناسه‌های **نسبیِ** import یک فایل (`./x.ts`, `../apps/api/…`) — برای بستارِ ادعای ب. */
export function relativeImportsIn(rawSource: string): string[] {
  const source = stripComments(rawSource);
  const found = new Set<string>();
  const patterns = [
    /(?:^|\n)\s*import\s[^;]*?from\s*["']([^"']+)["']/g,
    /(?:^|\n)\s*import\s*["']([^"']+)["']/g,
    /(?:^|\n)\s*export\s[^;]*?from\s*["']([^"']+)["']/g,
    /\bimport\(\s*["']([^"']+)["']\s*\)/g,
  ];
  for (const re of patterns) {
    for (const m of source.matchAll(re)) {
      const spec = m[1] ?? "";
      if (spec.startsWith("./") || spec.startsWith("../")) found.add(spec);
    }
  }
  return [...found].sort();
}

/** فایل‌سیستمِ تزریقی — تا بستار بدونِ دیسک هم آزمون‌پذیر باشد. */
export interface ClosureFs {
  read(path: string): string | null;
}

/**
 * بستارِ importهای نسبی از چند ورودی. مسیرها **نرمالِ posix** (نسبت به ریشه) هستند.
 * فایلِ نبودن یک import نسبی خطای این گیت نیست (tsc می‌گیردش) — فقط دنبال نمی‌شود.
 */
export function closureOf(entries: string[], fs: ClosureFs): string[] {
  const seen = new Set<string>();
  const queue = [...entries];
  while (queue.length > 0) {
    const file = queue.shift()!;
    if (seen.has(file)) continue;
    const source = fs.read(file);
    if (source === null) continue;
    seen.add(file);
    const dir = file.split("/").slice(0, -1);
    for (const spec of relativeImportsIn(source)) {
      const parts = [...dir];
      for (const seg of spec.split("/")) {
        if (seg === "..") parts.pop();
        else if (seg !== ".") parts.push(seg);
      }
      queue.push(parts.join("/"));
    }
  }
  return [...seen].sort();
}

/**
 * صاحبِ یک فایل: `root` برای `scripts/…`، نامِ ورک‌اسپیس برای `apps/<x>/…`/`packages/<x>/…`.
 */
export function ownerOf(file: string): { kind: "root" } | { kind: "workspace"; dir: string } {
  const m = /^(apps|packages)\/([^/]+)\//.exec(file);
  return m ? { kind: "workspace", dir: `${m[1]!}/${m[2]!}` } : { kind: "root" };
}

/**
 * ورک‌اسپیس‌هایی که در ایمیجِ api نصب می‌شوند: `apps/api` + بستارِ `workspace:*`ش + آن‌هایی که
 * `dependencies`ِ ریشه اعلام کرده (`--filter @hamboom/api... --filter hamboom` در Dockerfile).
 */
export function imageWorkspaces(
  manifests: ReadonlyMap<string, Manifest>,
  rootManifest: Manifest,
): Set<string> {
  const byName = new Map<string, string>();
  for (const [dir, m] of manifests) if (m.name !== undefined) byName.set(m.name, dir);
  const result = new Set<string>();
  const queue: string[] = ["apps/api"];
  for (const dep of Object.keys(rootManifest.dependencies ?? {})) {
    const dir = byName.get(dep);
    if (dir !== undefined) queue.push(dir);
  }
  while (queue.length > 0) {
    const dir = queue.shift()!;
    if (result.has(dir)) continue;
    result.add(dir);
    const m = manifests.get(dir);
    for (const dep of Object.keys(m?.dependencies ?? {})) {
      const depDir = byName.get(dep);
      if (depDir !== undefined) queue.push(depDir);
    }
  }
  return result;
}

/**
 * ★ ادعای ب (بازگشتی): هر فایلِ بستار در برابرِ `dependencies`ِ **صاحبش**؛ فایلِ ورک‌اسپیسِ
 * خارج از ایمیج قرمز است.
 */
export function checkProductionClosure(
  files: string[],
  fs: ClosureFs,
  rootManifest: Manifest,
  manifests: ReadonlyMap<string, Manifest>,
): Problem[] {
  const inImage = imageWorkspaces(manifests, rootManifest);
  const problems: Problem[] = [];
  for (const file of files) {
    const source = fs.read(file);
    if (source === null) continue;
    const owner = ownerOf(file);
    let prod: Set<string>;
    let label: string;
    if (owner.kind === "root") {
      prod = new Set(Object.keys(rootManifest.dependencies ?? {}));
      label = "ریشه";
    } else if (!inImage.has(owner.dir)) {
      problems.push({
        claim: `اسکریپتِ production به فایلی خارج از ایمیجِ api می‌رسد: ${file}`,
        detail: `${owner.dir} در نصبِ \`--filter @hamboom/api...\` نیست؛ روی VM این فایل اصلاً وجود ندارد`,
      });
      continue;
    } else {
      const m = manifests.get(owner.dir);
      prod = new Set(Object.keys(m?.dependencies ?? {}));
      label = m?.name ?? owner.dir;
    }
    for (const pkg of importsIn(source)) {
      if (prod.has(pkg)) continue;
      if (owner.kind === "workspace" && pkg === manifests.get(owner.dir)?.name) continue;
      problems.push({
        claim: `اسکریپتِ production به وابستگیِ dev-scope تکیه دارد: ${pkg}`,
        detail: `${file} داخلِ ایمیج اجرا می‌شود (صاحب: ${label})، ولی نصبِ \`--prod\` هرگز devDependencies را نمی‌آورد`,
      });
    }
  }
  return problems;
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
export function checkProductionScope(manifest: Manifest, used: Map<string, string[]>): Problem[] {
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
      checkDeclared(
        "t",
        { name: "@hamboom/realtime", dependencies: { ws: "*" } },
        use("@hamboom/config"),
      ).length === 1,
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
    ok:
      packageOf("@hamboom/config/x") === "@hamboom/config" && packageOf("fastify/y") === "fastify",
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

  // ★ M6: بستارِ نسبی — سه سناریو روی یک فایل‌سیستمِ ساختگی.
  const kw2 = "im" + "port";
  const fakeFs = (files: Record<string, string>): ClosureFs => ({
    read: (p) => files[p] ?? null,
  });
  const manifests = new Map<string, Manifest>([
    ["apps/api", { name: "@hamboom/api", dependencies: { pg: "*", "@hamboom/config": "*" } }],
    ["apps/realtime", { name: "@hamboom/realtime", dependencies: { ws: "*" } }],
    ["packages/config", { name: "@hamboom/config", dependencies: { zod: "*" } }],
  ]);
  const root: Manifest = {
    name: "hamboom",
    dependencies: { pg: "*" },
    devDependencies: { yjs: "*" },
  };
  const fsA = fakeFs({
    "scripts/entry.ts": `${kw2} { x } from "./helper.ts";`,
    "scripts/helper.ts": `${kw2} * as Y from "yjs";`,
  });
  cases.push({
    name: "★ M6: importِ نسبی دنبال می‌شود — کمکی به yjsِ dev-scope می‌رسد ⇒ قرمز",
    ok:
      checkProductionClosure(closureOf(["scripts/entry.ts"], fsA), fsA, root, manifests).length ===
      1,
  });
  cases.push({
    name: "همان بستار با yjs در dependenciesِ ریشه ⇒ سبز",
    ok:
      checkProductionClosure(
        closureOf(["scripts/entry.ts"], fsA),
        fsA,
        { ...root, dependencies: { pg: "*", yjs: "*" } },
        manifests,
      ).length === 0,
  });
  const fsB = fakeFs({
    "scripts/entry.ts": `${kw2} { db } from "../apps/api/src/plugins/db.ts";`,
    "apps/api/src/plugins/db.ts": `${kw2} pg from "pg";`,
  });
  cases.push({
    name: "★ M6: فایلِ apps/api در بستار با pg در dependenciesِ خودش ⇒ سبز",
    ok:
      checkProductionClosure(closureOf(["scripts/entry.ts"], fsB), fsB, root, manifests).length ===
      0,
  });
  const fsC = fakeFs({
    "scripts/entry.ts": `${kw2} { r } from "../apps/realtime/src/room.ts";`,
    "apps/realtime/src/room.ts": `${kw2} { WebSocket } from "ws";`,
  });
  cases.push({
    name: "★ M6: فایلِ apps/realtime در بستار ⇒ قرمز (در ایمیجِ api نصب نمی‌شود)",
    ok:
      checkProductionClosure(closureOf(["scripts/entry.ts"], fsC), fsC, root, manifests).length ===
      1,
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

  // ── ★ M6: ادعای ب روی **بستارِ** importهای نسبی، هر فایل در برابرِ صاحبش ──
  const diskFs: ClosureFs = {
    read: (p) => {
      try {
        return readFileSync(join(ROOT, p), "utf8");
      } catch {
        return null;
      }
    },
  };
  const manifests = new Map<string, Manifest>();
  for (const dir of workspaceDirs()) {
    manifests.set(
      relative(ROOT, dir).replaceAll("\\", "/"),
      JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as Manifest,
    );
  }
  const closure = closureOf(PRODUCTION_SCRIPTS, diskFs);
  problems.push(...checkProductionClosure(closure, diskFs, rootManifest, manifests));

  console.log(
    `پکیج‌های بررسی‌شده: ${checked} · اسکریپتِ production: ${PRODUCTION_SCRIPTS.length} · بستارِ نسبی: ${closure.length} فایل`,
  );
  if (problems.length > 0) {
    for (const p of problems) console.error(`✖ ${p.claim}\n    ${p.detail}`);
    console.error("\n✖ وابستگیِ اعلام‌نشده — نصبِ production این را در بوت می‌شکند.");
    process.exit(1);
  }
  console.log("✔ هر importِ bare در منیفستِ پکیجِ خودش اعلام شده است.");
}

main();
