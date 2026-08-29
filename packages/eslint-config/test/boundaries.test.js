import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { ESLint, Linter } from "eslint";
import { describe, expect, it } from "vitest";

import {
  apiBoundaries,
  assetsBoundaries,
  authCoreBoundaries,
  boardAccessDbBoundaries,
  canvasSyncBoundaries,
  processEnvDiscipline,
  realtimeBoundaries,
  sdkBoundaries,
  storageBoundaries,
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

  describe("storageBoundaries — تنها پکیجی که @aws-sdk مجاز است (M3 گام ۳٫۱)", () => {
    const config = storageBoundaries();

    it.each([
      "@hamboom/canvas-core",
      "@hamboom/canvas-sync",
      "@hamboom/sdk",
      "@hamboom/auth-core",
      "react",
      "react-dom",
      "@excalidraw/excalidraw",
      "ws",
      "pg",
      "ioredis",
      "axios",
      "@hamboom/api",
    ])("می‌گیرد: %s", (specifier) => {
      expect(isForbidden(config, specifier)).toBe(true);
    });

    // ★★ مهم‌ترین ادعای این پکیج: `@aws-sdk` **باید مجاز** بماند (P4). اگر روزی کسی
    //   آن را همین‌جا هم ببندد، خودِ لایه‌ای که P4 تجویزش کرده از کار می‌افتد.
    //   `@hamboom/config` هم لازم است (خواندنِ `s3EnvSchema`).
    it.each([
      "@aws-sdk/client-s3",
      "@aws-sdk/client-s3/dist/index.js",
      "@aws-sdk/s3-request-presigner",
      "@aws-sdk/s3-presigned-post",
      "@hamboom/config",
      "@hamboom/shared-types",
      "node:crypto",
    ])("مزاحمِ %s نمی‌شود", (specifier) => {
      expect(isForbidden(config, specifier)).toBe(false);
    });
  });

  describe("assetsBoundaries — لایه‌ی دامنه؛ برخلافِ storage، @aws-sdk **ممنوع** (M3 گام ۳٫۳)", () => {
    const config = assetsBoundaries();

    it.each([
      // ★★ ادعای اصلی و **برعکسِ storage**: assets حق ندارد @aws-sdk را ببیند (P4) — به S3
      //    فقط از راهِ @hamboom/storage می‌رسد. این همان چیزی است که storage را نازک نگه می‌دارد.
      "@aws-sdk/client-s3",
      "@aws-sdk/client-s3/dist/index.js",
      "@aws-sdk/s3-presigned-post",
      "@hamboom/canvas-core",
      "@hamboom/canvas-sync",
      "@hamboom/sdk",
      "@hamboom/auth-core",
      "react",
      "ws",
      "pg",
      "axios",
      "@hamboom/api",
    ])("می‌گیرد: %s", (specifier) => {
      expect(isForbidden(config, specifier)).toBe(true);
    });

    // مجاز: storage (مصرفش می‌کند)، shared-types، config.
    it.each(["@hamboom/storage", "@hamboom/shared-types", "@hamboom/config", "node:crypto"])(
      "مزاحمِ %s نمی‌شود",
      (specifier) => {
        expect(isForbidden(config, specifier)).toBe(false);
      },
    );
  });

  describe("authCoreBoundaries — منطقِ خالص + پورت؛ pg/ioredis/@aws-sdk ممنوع (M3 فاز ۴)", () => {
    const config = authCoreBoundaries();

    it.each([
      // ★ auth-core به DB مستقیم وصل نمی‌شود (پورت است، پیاده‌سازیِ DB در apps/api)، و @aws-sdk هم ندارد.
      "@aws-sdk/client-s3",
      "@hamboom/canvas-core",
      "@hamboom/canvas-sync",
      "@hamboom/sdk",
      "@hamboom/storage",
      "react",
      "ws",
      "pg",
      "ioredis",
      "axios",
      "@hamboom/api",
    ])("می‌گیرد: %s", (specifier) => {
      expect(isForbidden(config, specifier)).toBe(true);
    });

    // مجاز: jose (JWT)، shared-types، config، node:crypto.
    it.each(["jose", "@hamboom/shared-types", "@hamboom/config", "node:crypto"])(
      "مزاحمِ %s نمی‌شود",
      (specifier) => {
        expect(isForbidden(config, specifier)).toBe(false);
      },
    );
  });

  describe("apiBoundaries — لایه‌ی REST؛ @aws-sdk/UI/sdk ممنوع، storage/auth-core مجاز (M3 فاز ۵)", () => {
    const config = apiBoundaries();

    it.each([
      // P4: به S3 فقط از راهِ storage — SDKِ خام ممنوع.
      "@aws-sdk/client-s3",
      "@aws-sdk/lib-storage",
      // موتورِ رندر/React کارِ apps/web است.
      "@hamboom/canvas-core",
      "@hamboom/canvas-sync",
      "react",
      "react-dom",
      "@excalidraw/excalidraw",
      // ★ دورِ باطل: sdk کلاینتِ api است، نه برعکس.
      "@hamboom/sdk",
      "@hamboom/sdk/client",
      // اپِ دیگر را هم import نمی‌کند (APPS_PATTERN).
      "@hamboom/realtime",
    ])("می‌گیرد: %s", (specifier) => {
      expect(isForbidden(config, specifier)).toBe(true);
    });

    // ★★ نگهبانِ اشتباهِ محتمل: بستنِ storage/auth-core یعنی بستنِ همان مسیری که P4 و ADR-012 خواستند.
    //    api بالاترین مصرف‌کننده‌ی پکیج‌های M3 است — این‌ها باید **مجاز** بمانند.
    it.each([
      "@hamboom/storage",
      "@hamboom/auth-core",
      "@hamboom/assets",
      "@hamboom/config",
      "@hamboom/shared-types",
      "pg",
      "ioredis",
      "fastify",
      "kysely",
    ])("مزاحمِ %s نمی‌شود", (specifier) => {
      expect(isForbidden(config, specifier)).toBe(false);
    });
  });

  describe("sdkBoundaries — کلاینتِ نازک؛ لایه‌های سرور/UI/Yjs/HTTP-lib ممنوع (M3 فاز ۶)", () => {
    const config = sdkBoundaries();

    it.each([
      // لایه‌های سرور — sdk فقط با HTTP حرف می‌زند، مستقیم به این‌ها وصل نمی‌شود.
      "@hamboom/storage",
      "@hamboom/auth-core",
      "@hamboom/assets",
      // مدلِ Yjs/بوم — sdk با DTOها کار می‌کند، نه سند.
      "@hamboom/ydoc-schema",
      "@hamboom/canvas-core",
      "@hamboom/canvas-sync",
      // UI — کارِ apps/web که این را wrap می‌کند.
      "react",
      "react-dom",
      "@excalidraw/excalidraw",
      // کتابخانه‌ی HTTP — sdk از fetchِ سراسری استفاده می‌کند.
      "axios",
      "ky",
      "@aws-sdk/client-s3",
      // اپِ دیگر را هم import نمی‌کند (APPS_PATTERN — به‌ویژه دورِ باطلِ @hamboom/api).
      "@hamboom/api",
    ])("می‌گیرد: %s", (specifier) => {
      expect(isForbidden(config, specifier)).toBe(true);
    });

    // ★ تنها مجازِ sdk: shared-types (منبعِ typeها). بستنش یعنی sdk نمی‌تواند کارش را بکند.
    it("مزاحمِ @hamboom/shared-types نمی‌شود", () => {
      expect(isForbidden(config, "@hamboom/shared-types")).toBe(false);
    });
  });

  describe("boardAccessDbBoundaries — آداپتورِ نازکِ pg؛ UI/بوم/sdk/storage ممنوع (M3 فاز ۷)", () => {
    const config = boardAccessDbBoundaries();

    it.each([
      "@hamboom/canvas-core",
      "@hamboom/ydoc-schema",
      "@hamboom/sdk",
      "@hamboom/storage",
      "react",
      "@excalidraw/excalidraw",
      "@aws-sdk/client-s3",
      "ws",
      "ioredis",
      "@hamboom/api", // اپ را import نمی‌کند
    ])("می‌گیرد: %s", (specifier) => {
      expect(isForbidden(config, specifier)).toBe(true);
    });

    // ★ مجازها: pg (کوئری)، auth-core (تایپِ پورت)، shared-types. بستنشان یعنی reader نمی‌تواند کارش را بکند.
    it.each(["pg", "@hamboom/auth-core", "@hamboom/shared-types"])(
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
    // ★ storage: `@aws-sdk` مجاز است، ولی UI (react) نه — همین سیم‌کشی را می‌سنجد.
    ["packages/storage", 'import React from "react";'],
    // ★★ assets **برعکسِ storage**: importِ خامِ `@aws-sdk` باید خطا بخورد (به S3 فقط از راهِ storage).
    ["packages/assets", 'import { S3Client } from "@aws-sdk/client-s3";'],
    // ★ auth-core منطقِ خالص است: importِ خامِ `pg` باید خطا بخورد (DB در apps/api، فاز ۵).
    ["packages/auth-core", 'import { Pool } from "pg";'],
    // ★ apps/api: importِ خامِ `@aws-sdk` باید خطا بخورد (به S3 فقط از راهِ storage، P4).
    ["apps/api", 'import { S3Client } from "@aws-sdk/client-s3";'],
    // ★ sdk: importِ لایه‌ی سرور (@hamboom/storage) باید خطا بخورد — sdk فقط با HTTP حرف می‌زند.
    ["packages/sdk", 'import { createS3ObjectStore } from "@hamboom/storage";'],
    // ★ board-access-db: importِ UI (react) باید خطا بخورد — این فقط یک کوئریِ pg است.
    ["packages/board-access-db", 'import React from "react";'],
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
    // ★★ ادعای اصلیِ P4 روی خودِ storage: importِ خامِ `@aws-sdk` **مجاز** است.
    [
      "packages/storage",
      'import { S3Client } from "@aws-sdk/client-s3";\nexport const c = S3Client;',
    ],
    // ★ assets مجاز است @hamboom/storage را ببیند (مصرفش می‌کند، نه دروازه‌ی S3ِ دوم).
    [
      "packages/assets",
      'import { createS3ObjectStore } from "@hamboom/storage";\nexport const c = createS3ObjectStore;',
    ],
    // ★ auth-core مجاز است `jose` را ببیند (JWT).
    ["packages/auth-core", 'import { SignJWT } from "jose";\nexport const s = SignJWT;'],
    // ★ apps/api مجاز است `@hamboom/storage` را ببیند (پلاگینِ s3 — مسیرِ درستِ P4).
    [
      "apps/api",
      'import { createS3ObjectStore } from "@hamboom/storage";\nexport const c = createS3ObjectStore;',
    ],
    // ★ sdk مجاز است `@hamboom/shared-types` را ببیند (منبعِ typeها — تنها وابستگی‌اش).
    [
      "packages/sdk",
      'import type { Board } from "@hamboom/shared-types";\nexport const b: Board | null = null;',
    ],
    // ★ board-access-db مجاز است `pg` را ببیند (کوئریِ دسترسیِ بورد — مسیرِ درستش).
    [
      "packages/board-access-db",
      'import type pg from "pg";\nexport type Q = Pick<pg.Pool, "query">;',
    ],
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

  // ★ storage برعکسِ بقیه است: `@aws-sdk` **باید** در manifest باشد (P4)، ولی UI/شبکه نه.
  it("storage فقط @aws-sdk را اعلام کرده، نه UI یا شبکه/دیتابیسِ دیگر", () => {
    const deps = declaredDeps("packages/storage");
    expect(deps.some((d) => d.startsWith("@aws-sdk/"))).toBe(true);
    const forbidden = [
      "react",
      "react-dom",
      "@excalidraw/excalidraw",
      "@hamboom/canvas-core",
      "@hamboom/canvas-sync",
      "ws",
      "pg",
      "ioredis",
      "axios",
      "ky",
    ];
    expect(deps.filter((d) => forbidden.includes(d))).toEqual([]);
  });

  // ★ assets برعکسِ storage: `@hamboom/storage` **باید** باشد، `@aws-sdk` **نباید** — دروازه‌ی S3 آنجاست.
  it("assets مصرف‌کننده‌ی @hamboom/storage است، نه @aws-sdk", () => {
    const deps = declaredDeps("packages/assets");
    expect(deps).toContain("@hamboom/storage");
    expect(deps.filter((d) => d.startsWith("@aws-sdk/"))).toEqual([]);
    expect(deps).not.toContain("react");
  });

  // ★ auth-core منطقِ خالص است: jose/shared-types **بله**، pg/ioredis/@aws-sdk **نه** (DB در apps/api).
  it("auth-core منطقِ خالص است — jose و shared-types را دارد، نه pg/ioredis/@aws-sdk", () => {
    const deps = declaredDeps("packages/auth-core");
    expect(deps).toContain("jose");
    expect(deps).toContain("@hamboom/shared-types");
    expect(deps.filter((d) => d.startsWith("@aws-sdk/"))).toEqual([]);
    expect(deps).not.toContain("pg");
    expect(deps).not.toContain("ioredis");
  });

  // ★ apps/api لایه‌ی REST است: به S3 فقط از راهِ storage (نه @aws-sdk)، نه موتورِ رندر، نه sdk (دورِ باطل).
  //   وابستگی‌های مثبتش افزایشی رشد می‌کنند (fastify/kysely با مصرف‌کننده‌شان، گام ۵٫۱/۵٫۲)؛ مرزِ تعریف‌کننده‌اش نفی است.
  it("apps/api @aws-sdk/react/canvas-core/sdk را اعلام نکرده", () => {
    const deps = declaredDeps("apps/api");
    expect(deps).toContain("@hamboom/shared-types");
    expect(deps.filter((d) => d.startsWith("@aws-sdk/"))).toEqual([]);
    expect(deps).not.toContain("react");
    expect(deps).not.toContain("react-dom");
    expect(deps).not.toContain("@hamboom/canvas-core");
    expect(deps).not.toContain("@hamboom/canvas-sync");
    expect(deps).not.toContain("@hamboom/sdk");
  });

  // ★ sdk کلاینتِ نازک است: فقط shared-types، نه لایه‌های سرور/UI/HTTP-lib.
  it("sdk فقط @hamboom/shared-types را اعلام کرده", () => {
    const deps = declaredDeps("packages/sdk");
    expect(deps).toContain("@hamboom/shared-types");
    expect(deps.filter((d) => d.startsWith("@aws-sdk/"))).toEqual([]);
    for (const forbidden of [
      "@hamboom/storage",
      "@hamboom/auth-core",
      "@hamboom/assets",
      "@hamboom/api",
      "react",
      "axios",
      "ky",
    ]) {
      expect(deps).not.toContain(forbidden);
    }
  });

  // ★ board-access-db آداپتورِ pg است: pg + auth-core + shared-types بله، UI/canvas/sdk/storage نه.
  it("board-access-db pg + auth-core + shared-types را دارد، نه UI/storage/sdk", () => {
    const deps = declaredDeps("packages/board-access-db");
    expect(deps).toContain("pg");
    expect(deps).toContain("@hamboom/auth-core");
    expect(deps).toContain("@hamboom/shared-types");
    for (const forbidden of ["@hamboom/storage", "@hamboom/sdk", "@hamboom/canvas-core", "react"]) {
      expect(deps).not.toContain(forbidden);
    }
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
