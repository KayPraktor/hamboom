import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { ESLint, Linter } from "eslint";
import { describe, expect, it } from "vitest";

import { canvasSyncBoundaries, realtimeBoundaries, ydocSchemaBoundaries } from "../boundaries.js";

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
