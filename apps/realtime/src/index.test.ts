import * as Y from "yjs";
import { describe, expect, it } from "vitest";

import { SERVED_SCHEMA_VERSION } from "./index.ts";

/**
 * تستِ دودِ اسکلت (گام ۰٫۲).
 *
 * ادعای واقعی‌اش معماری است: **سرور می‌تواند `ydoc-schema` را مصرف کند بدون
 * اینکه چیزی از دنیای مرورگر لازم شود.** اگر روزی کسی canvas-core یا React را
 * وارد `ydoc-schema` کند، این تست در محیطِ `node` می‌شکند — قبل از اینکه در
 * production معلوم شود. (لایه‌ی دومِ همین گارد: بازرسیِ manifest در
 * `packages/eslint-config/test/boundaries.test.js`.)
 */
describe("اسکلتِ apps/realtime", () => {
  it("ydoc-schema در یک اپِ Nodeِ خالص مصرف‌شدنی است", () => {
    expect(SERVED_SCHEMA_VERSION).toBe(1);
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
