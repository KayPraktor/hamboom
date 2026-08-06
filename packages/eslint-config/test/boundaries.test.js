import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { ESLint, Linter } from "eslint";
import { describe, expect, it } from "vitest";

import {
  canvasSyncBoundaries,
  processEnvDiscipline,
  realtimeBoundaries,
  ydocSchemaBoundaries,
} from "../boundaries.js";

/**
 * خودآزمونِ گیت‌های مرزیِ ماژول M2 — «قاعده‌ای که خودش تست نشده، گیت نیست».
 *
 * ── چرا `Linter`/`ESLint` و نه `RuleTester` ────────────────────────────
 *
 * `RuleTester` برای وقتی است که **قاعده را خودمان نوشته‌ایم** (مثل
 * `require-capture-update` که در `canvas-core/test/capture-update-rule.test.ts`
 * با RuleTester آزموده می‌شود). اینجا قاعده مالِ خودِ ESLint است
 * (`no-restricted-imports`)؛ چیزی که می‌تواند غلط باشد **فهرستِ الگوهای ما** و
 * **سیم‌کشی‌اش** است. پس:
 *
 *   لایه‌ی ۱ — `Linter` روی خروجیِ **واقعیِ** همان factoryها: اگر فهرست عوض شود،
 *              تست می‌فهمد. (RuleTester مجبورمان می‌کرد optionها را دستی کپی
 *              کنیم — یعنی یک نسخه‌ی دوم که می‌تواند از config واگرا شود.)
 *   لایه‌ی ۲ — `ESLint` روی `eslint.config.js`ِ **واقعیِ** هر پکیج: ثابت می‌کند
 *              قاعده به پکیج **وصل** است. لایه‌ی ۱ این را اثبات نمی‌کند؛ در M1
 *              هم هر دو لایه لازم شد.
 *   لایه‌ی ۳ — بازرسیِ `package.json`: گیتِ import فقط `src/` را می‌بیند، پس یک
 *              وابستگیِ ممنوعِ اضافه‌شده به manifest از چشمش می‌افتد.
 */

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..", "..");

const linter = new Linter();

/** آیا این پیکربندی، importِ فلان specifier را خطا می‌کند؟ */
function isForbidden(config, specifier) {
  const messages = linter.verify(`import x from ${JSON.stringify(specifier)};\n`, {
    languageOptions: { ecmaVersion: 2023, sourceType: "module" },
    rules: config.rules,
  });
  return messages.length > 0;
}

/**
 * ── لایه‌ی ۱: فهرستِ الگوها ─────────────────────────────────────────────
 *
 * `allowed` به‌اندازه‌ی `forbidden` مهم است: قاعده‌ای که مثبتِ کاذب می‌دهد دور زده
 * می‌شود و آن‌وقت موردِ واقعی را هم نمی‌گیرد (درسِ گام ۳٫۳ در M1).
 */
describe("لایه‌ی ۱ — الگوهای مرزی", () => {
  describe("ydocSchemaBoundaries — پایین‌ترین لایه، هم مرورگر هم سرور", () => {
    const config = ydocSchemaBoundaries();

    it.each([
      "@hamboom/canvas-core",
      "@hamboom/canvas-core/sync",
      "@hamboom/canvas-sync",
      "@hamboom/sdk",
      "@hamboom/storage",
      "react",
      "react-dom",
      "@excalidraw/excalidraw",
      "@aws-sdk/client-s3",
      "@aws-sdk/client-s3/dist/index.js",
      "ws",
      "pg",
      "ioredis",
      "@hamboom/api",
    ])("می‌گیرد: %s", (specifier) => {
      expect(isForbidden(config, specifier)).toBe(true);
    });

    it.each(["yjs", "lib0/encoding", "@hamboom/shared-types", "node:crypto"])(
      "مزاحمِ %s نمی‌شود",
      (specifier) => {
        expect(isForbidden(config, specifier)).toBe(false);
      },
    );
  });

  describe("canvasSyncBoundaries — کلاینت، تنها پلِ مجاز به canvas-core", () => {
    const config = canvasSyncBoundaries();

    it.each(["@hamboom/sdk", "@hamboom/storage", "@aws-sdk/client-s3", "ws", "pg", "ioredis"])(
      "می‌گیرد: %s",
      (specifier) => {
        expect(isForbidden(config, specifier)).toBe(true);
      },
    );

    // ★ مهم‌ترین ادعای این فایل: canvas-sync **باید** بتواند canvas-core را
    //   به‌صورت مقدار ببیند تا `assertEmittable` را از همان‌جا صدا بزند
    //   (ADR-024 — یک منطق، یک منبع). اگر این روزی ممنوع شود، binder مجبور
    //   می‌شود نگهبانِ echo را از نو بنویسد.
    it.each([
      "@hamboom/canvas-core",
      "@hamboom/canvas-core/sync",
      "@hamboom/ydoc-schema",
      "yjs",
      "y-protocols/awareness",
    ])("مزاحمِ %s نمی‌شود", (specifier) => {
      expect(isForbidden(config, specifier)).toBe(false);
    });
  });

  describe("realtimeBoundaries — سرور", () => {
    const config = realtimeBoundaries();

    it.each([
      "@hamboom/canvas-core",
      "@hamboom/canvas-sync",
      "@hamboom/sdk",
      "react",
      "@excalidraw/excalidraw",
      "@aws-sdk/client-s3",
      "@aws-sdk/lib-storage",
    ])("می‌گیرد: %s", (specifier) => {
      expect(isForbidden(config, specifier)).toBe(true);
    });

    // ⚠️ این دو عمداً مجازند و تستشان **نگهبانِ یک اشتباهِ محتمل** است: کسی که
    //   P4 را سرسری بخواند ممکن است `@hamboom/storage` را هم ببندد — در حالی که
    //   خودِ P4 آن را مسیرِ درست می‌داند، و ADR-012 صریحاً می‌خواهد realtime و API
    //   از یک `effectiveBoardRole` مشترک در auth-core استفاده کنند. بستنشان یعنی
    //   بستنِ همان مسیری که ADR تجویز کرده.
    it.each(["@hamboom/storage", "@hamboom/auth-core", "@hamboom/ydoc-schema", "yjs", "ws"])(
      "مزاحمِ %s نمی‌شود",
      (specifier) => {
        expect(isForbidden(config, specifier)).toBe(false);
      },
    );
  });

  /**
   * تطبیقِ گلاب در `no-restricted-imports` خلافِ شهودِ رایج است: `*` **از `/`
   * عبور می‌کند**. این در گام ۰٫۲ probe شد و اینجا pin می‌شود تا کسی بعداً
   * الگوها را «اصلاح» نکند یا فرض نکند زیرمسیر از گیت رد می‌شود.
   */
  it("‏`*` از `/` عبور می‌کند — زیرمسیرِ عمیق هم گرفته می‌شود", () => {
    const config = ydocSchemaBoundaries();
    expect(isForbidden(config, "@aws-sdk/client-s3")).toBe(true);
    expect(isForbidden(config, "@aws-sdk/client-s3/dist/submodule/deep.js")).toBe(true);
    // ورودیِ بدونِ گلاب هم زیرمسیر را می‌گیرد:
    expect(isForbidden(config, "@hamboom/sdk/client")).toBe(true);
  });
});

/**
 * ── لایه‌ی ۲: سیم‌کشیِ واقعی ─────────────────────────────────────────────
 *
 * لایه‌ی ۱ فقط ثابت می‌کند factory درست است. اگر کسی یادش برود آن را در
 * `eslint.config.js`ِ پکیج صدا بزند، یا `files` را اشتباه بنویسد، لایه‌ی ۱
 * همچنان سبز می‌ماند و **گیت عملاً وجود ندارد**. اینجا با configِ واقعیِ هر
 * پکیج lint می‌کنیم.
 */
describe("لایه‌ی ۲ — سیم‌کشی به eslint.config.js واقعی", () => {
  /** یک فایلِ ساختگی داخلِ `src/` همان پکیج را با configِ خودش lint می‌کند. */
  async function lintInPackage(packageDir, code) {
    const cwd = join(repoRoot, packageDir);
    const eslint = new ESLint({
      cwd,
      overrideConfigFile: join(cwd, "eslint.config.js"),
    });
    const [result] = await eslint.lintText(code, {
      filePath: join(cwd, "src", "__boundary_probe__.ts"),
    });
    return result.messages;
  }

  it.each([
    ["packages/ydoc-schema", 'import { HamboomCanvas } from "@hamboom/canvas-core";'],
    ["packages/canvas-sync", 'import { WebSocketServer } from "ws";'],
    ["apps/realtime", 'import { S3Client } from "@aws-sdk/client-s3";'],
  ])("%s نقضِ واقعی را خطا می‌کند", async (packageDir, code) => {
    const messages = await lintInPackage(packageDir, code);
    expect(messages.some((m) => m.ruleId === "no-restricted-imports")).toBe(true);
  });

  it.each([
    ["packages/ydoc-schema", 'import * as Y from "yjs";\nexport const doc = new Y.Doc();'],
    [
      "packages/canvas-sync",
      'import { assertEmittable } from "@hamboom/canvas-core/sync";\nexport const g = assertEmittable;',
    ],
    ["apps/realtime", 'import * as Y from "yjs";\nexport const doc = new Y.Doc();'],
  ])("%s importِ مجاز را خطا نمی‌کند", async (packageDir, code) => {
    const messages = await lintInPackage(packageDir, code);
    expect(messages.filter((m) => m.ruleId === "no-restricted-imports")).toEqual([]);
  });

  /**
   * ★★ سیم‌کشیِ قاعده‌های `captureUpdate` — گام ۳٫۲.
   *
   * `RuleTester` (در [`remote-capture-rule.test.js`](remote-capture-rule.test.js)) ثابت
   * می‌کند **منطقِ قاعده** درست است. اینجا ثابت می‌شود قاعده به فایلِ **درست** وصل
   * است — همان تفکیکی که در گام ۰٫۲ یک باگِ واقعی گرفت.
   *
   * ⚠️ مسیرِ فایل معنا دارد: `remote-writes-never` عمداً فقط روی
   * `src/apply-remote.ts` اعمال می‌شود، چون مسیرِ **محلی** واقعاً `IMMEDIATELY`
   * می‌خواهد. اگر روی کلِ پکیج بود، به یک بن‌بست تبدیل می‌شد.
   */
  async function lintFile(packageDir, relativePath, code) {
    const cwd = join(repoRoot, packageDir);
    const eslint = new ESLint({ cwd, overrideConfigFile: join(cwd, "eslint.config.js") });
    const [result] = await eslint.lintText(code, { filePath: join(cwd, relativePath) });
    return result.messages;
  }

  const IMMEDIATELY = 'declare const api: any;\napi.updateScene({ captureUpdate: "IMMEDIATELY" });';

  it("★ `IMMEDIATELY` در مسیرِ remote خطا می‌گیرد", async () => {
    const messages = await lintFile("packages/canvas-sync", "src/apply-remote.ts", IMMEDIATELY);
    expect(messages.some((m) => m.ruleId === "hamboom/remote-writes-never")).toBe(true);
  });

  it("★ `commitGesture` در مسیرِ remote خطا می‌گیرد", async () => {
    const messages = await lintFile(
      "packages/canvas-sync",
      "src/apply-remote.ts",
      "declare const api: any;\ncommitGesture(api, []);",
    );
    expect(messages.some((m) => m.ruleId === "hamboom/remote-writes-never")).toBe(true);
  });

  it("`NEVER` در همان فایل خطا نمی‌گیرد", async () => {
    const messages = await lintFile(
      "packages/canvas-sync",
      "src/apply-remote.ts",
      'declare const api: any;\napi.updateScene({ captureUpdate: "NEVER" });',
    );
    expect(messages.filter((m) => m.ruleId === "hamboom/remote-writes-never")).toEqual([]);
  });

  it("★ همان `IMMEDIATELY` در مسیرِ **محلی** مجاز است", async () => {
    // اگر اینجا هم خطا می‌داد، قاعده به بن‌بست تبدیل می‌شد و اولین کسی که به
    // مسیرِ محلی دست بزند خاموشش می‌کرد — و آن‌وقت مسیرِ remote هم بی‌نگهبان می‌شد.
    const messages = await lintFile("packages/canvas-sync", "src/emit-local.ts", IMMEDIATELY);
    expect(messages.filter((m) => m.ruleId === "hamboom/remote-writes-never")).toEqual([]);
  });

  it("`require-capture-update` هم روی `canvas-sync` وصل است", async () => {
    const messages = await lintFile(
      "packages/canvas-sync",
      "src/emit-local.ts",
      "declare const api: any;\napi.updateScene({ elements: [] });",
    );
    expect(messages.some((m) => m.ruleId === "hamboom/require-capture-update")).toBe(true);
  });
});

/**
 * ── لایه‌ی ۳: manifest ─────────────────────────────────────────────────
 *
 * گیتِ import فقط چیزی را می‌بیند که در `src/` نوشته شده. اگر کسی `react` را به
 * `dependencies`ِ `ydoc-schema` اضافه کند و هنوز importش نکند، هر دو لایه‌ی بالا
 * سبزند — ولی مرز عملاً شکسته و اولین importِ بعدی طبیعی به نظر می‌رسد.
 */
describe("لایه‌ی ۳ — وابستگی‌های اعلام‌شده در package.json", () => {
  function declaredDeps(packageDir) {
    const manifest = JSON.parse(readFileSync(join(repoRoot, packageDir, "package.json"), "utf8"));
    return Object.keys({ ...manifest.dependencies, ...manifest.peerDependencies });
  }

  it("ydoc-schema هیچ وابستگیِ UI یا سرور اعلام نکرده", () => {
    const forbidden = [
      "react",
      "react-dom",
      "@excalidraw/excalidraw",
      "@hamboom/canvas-core",
      "@hamboom/canvas-sync",
      "ws",
      "pg",
      "ioredis",
    ];
    expect(declaredDeps("packages/ydoc-schema").filter((d) => forbidden.includes(d))).toEqual([]);
  });

  it("apps/realtime نه موتورِ رندر اعلام کرده نه SDKِ خامِ S3", () => {
    const deps = declaredDeps("apps/realtime");
    expect(deps.filter((d) => d.startsWith("@aws-sdk/"))).toEqual([]);
    expect(deps).not.toContain("@hamboom/canvas-core");
    expect(deps).not.toContain("react");
  });
});

/**
 * ── انضباطِ `process.env` (PLAN بخش ۴) ─────────────────────────────────
 *
 * همان دو لایه‌ی بالا، برای گیتِ «فقط `packages/config` حق خواندنِ محیط را دارد».
 * لایه‌ی ۲ اینجا **مهم‌تر** از همیشه است، چون نکته‌ی ظریفش این است که این قاعده
 * باید در سه پکیج روشن باشد و در `packages/config` روشن **نباشد** — و یک اشتباه
 * در هر جهت بی‌صدا است: یا گیت وجود ندارد، یا خودِ config نمی‌تواند کارش را بکند.
 */
describe("انضباطِ process.env", () => {
  const config = processEnvDiscipline();

  it.each([
    "const x = process.env.DATABASE_URL;",
    'const x = process.env["DATABASE_URL"];',
    "const { DATABASE_URL } = process.env;",
    "if (process.env.NODE_ENV === 'production') { }",
  ])("می‌گیرد: %s", (code) => {
    const messages = linter.verify(code, {
      languageOptions: { ecmaVersion: 2023, sourceType: "module" },
      rules: config.rules,
    });
    expect(messages.length).toBeGreaterThan(0);
  });

  it.each(["const x = process.argv[2];", "const x = someObject.env.FOO;", "process.exit(1);"])(
    "مزاحمِ %s نمی‌شود",
    (code) => {
      const messages = linter.verify(code, {
        languageOptions: { ecmaVersion: 2023, sourceType: "module" },
        rules: config.rules,
      });
      expect(messages).toEqual([]);
    },
  );

  describe("سیم‌کشی", () => {
    async function lintInPackage(packageDir, code) {
      const cwd = join(repoRoot, packageDir);
      const eslint = new ESLint({ cwd, overrideConfigFile: join(cwd, "eslint.config.js") });
      const [result] = await eslint.lintText(code, {
        filePath: join(cwd, "src", "__env_probe__.ts"),
      });
      return result.messages;
    }

    it.each(["packages/ydoc-schema", "packages/canvas-sync", "apps/realtime"])(
      "%s خواندنِ مستقیمِ process.env را خطا می‌کند",
      async (packageDir) => {
        const messages = await lintInPackage(packageDir, "export const x = process.env.RT_PORT;");
        expect(messages.some((m) => m.ruleId === "no-restricted-syntax")).toBe(true);
      },
    );

    // ★ جهتِ دوم: خودِ `packages/config` **باید** بتواند بخواند، وگرنه تنها نقطه‌ی
    //   مجازِ خواندنِ محیط هم بسته می‌شود و قاعده از یک گیت به یک بن‌بست تبدیل می‌شود.
    it("packages/config خودش مجاز است بخواند", async () => {
      const messages = await lintInPackage(
        "packages/config",
        "export const x = process.env.RT_PORT;",
      );
      expect(messages.filter((m) => m.ruleId === "no-restricted-syntax")).toEqual([]);
    });
  });
});
