import { execFileSync } from "node:child_process";

import * as Y from "yjs";
import { describe, expect, it } from "vitest";

import { SERVED_SCHEMA_VERSION } from "./index.ts";

/**
 * تستِ دودِ اسکلت (گام ۰٫۲) — ★ **در گام ۴٫۳ واقعی شد.**
 *
 * ادعای این فایل معماری است: **سرور می‌تواند `ydoc-schema` را در Nodeِ خالص
 * مصرف کند.**
 *
 * ⚠️ **ولی تا گام ۴٫۳ آن را اثبات نمی‌کرد.** vitest با `environment: "node"`
 * اجرا می‌شود، که همان Node نیست: resolverِ Vite زیرِ آن importهای **بدونِ
 * پسوند** را حدس می‌زند و ماژول‌های TypeScript را transform می‌کند. Nodeِ واقعی
 * هیچ‌کدام را نمی‌کند — فقط تایپ‌ها را strip می‌کند.
 *
 * نتیجه‌اش یک **سبزِ دروغین** بود: این تست سال‌ها سبز می‌مانْد در حالی که
 * `node apps/realtime/src/main.ts` اصلاً بالا نمی‌آمد. دو چیز پشتش پنهان شده
 * بود و هر دو در گام ۴٫۳ بیرون آمدند:
 *
 * ۱. importهای بدونِ پسوند در `shared-types` → `ERR_MODULE_NOT_FOUND`.
 * ۲. **parameter property** (`constructor(readonly x: T)`) → Node آن را
 *    strip نمی‌تواند بکند (`ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`).
 *
 * پس حالا ادعا با **خودِ Node** سنجیده می‌شود، نه با محیطِ vitest.
 */
describe("اسکلتِ apps/realtime", () => {
  it("ydoc-schema در یک اپِ Nodeِ خالص مصرف‌شدنی است", () => {
    expect(SERVED_SCHEMA_VERSION).toBe(1);
  });

  it("★★ و این ادعا با **خودِ Node** سنجیده می‌شود، نه با محیطِ vitest", () => {
    // ⚠️ اگر این را به یک `import` عادی تبدیل کنی، دوباره سبزِ دروغین می‌شود:
    //    کلِ نکته این است که یک **فرایندِ Nodeِ جدا** ماژول را بار کند.
    // ⚠️ **URL، نه مسیرِ فایل.** روی ویندوز `import("G:\\…")` با
    //    `ERR_UNSUPPORTED_ESM_URL_SCHEME` می‌افتد چون `g:` را یک پروتکل می‌بیند؛
    //    `import()`ِ پویا فقط `file://` می‌پذیرد.
    const entry = new URL("./index.ts", import.meta.url).href;
    const output = execFileSync(
      process.execPath,
      [
        "-e",
        `import(${JSON.stringify(entry)})
           .then((m) => process.stdout.write(String(m.SERVED_SCHEMA_VERSION)))
           .catch((error) => { process.stderr.write(String(error)); process.exit(1); })`,
      ],
      { encoding: "utf8", timeout: 60_000 },
    );

    expect(output.trim()).toBe("1");
  });

  it("Y.Doc در سرور ساخته و سریال می‌شود", () => {
    const doc = new Y.Doc();
    doc.getMap("elements").set("stk_1", { x: 10, y: 20 });

    const update = Y.encodeStateAsUpdate(doc);
    expect(update.byteLength).toBeGreaterThan(0);

    // همان چیزی که بارگذاریِ اتاق در گام ۴٫۲ انجام می‌دهد: سندِ نو + اعمالِ update.
    const restored = new Y.Doc();
    Y.applyUpdate(restored, update);
    expect(restored.getMap("elements").get("stk_1")).toEqual({ x: 10, y: 20 });
  });
});
