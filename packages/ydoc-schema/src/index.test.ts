import { hbElement } from "@hamboom/shared-types";
import * as Y from "yjs";
import { describe, expect, it } from "vitest";

import { DOC_ROOTS, SCHEMA_VERSION } from "./index.ts";

/**
 * تستِ دودِ اسکلت (گام ۰٫۲).
 *
 * چیزی که واقعاً می‌آزماید سه ادعای زیرساختی است، نه منطقِ محصولی:
 * ۱. `yjs` در Node واقعاً بارگذاری و اجرا می‌شود (نه فقط typecheck).
 * ۲. `shared-types` از اینجا در دسترس است — قراردادِ عنصر همان است که
 *    codecِ گام ۲٫۱ باید تولید کند.
 * ۳. نام‌های ریشه دقیقاً همان‌هایی‌اند که PLAN بخش ۷٫۱ می‌گوید.
 */
describe("اسکلتِ ydoc-schema", () => {
  it("yjs در Node اجرا می‌شود و ریشه‌های نام‌دار ساخته می‌شوند", () => {
    const doc = new Y.Doc();
    const elements = doc.getMap(DOC_ROOTS.elements);
    elements.set("stk_1", "placeholder");

    expect(elements.get("stk_1")).toBe("placeholder");
    // اثباتِ اینکه واقعاً یک سندِ CRDT است، نه یک Map ساده:
    expect(Y.encodeStateAsUpdate(doc).byteLength).toBeGreaterThan(0);
  });

  it("پنج ریشه‌ی PLAN بخش ۷٫۱ تعریف شده‌اند", () => {
    expect(Object.values(DOC_ROOTS)).toEqual([
      "meta",
      "elements",
      "assets",
      "appState",
      "commentPins",
    ]);
  });

  it("قراردادِ عنصر از shared-types در دسترس است", () => {
    // فقط اثباتِ دسترسی و مرزِ وابستگی — اعتبارسنجیِ واقعی کارِ گام ۲٫۱ است.
    expect(typeof hbElement.parse).toBe("function");
  });

  it("نسخه‌ی schema یک عددِ صحیحِ مثبت است", () => {
    expect(Number.isInteger(SCHEMA_VERSION)).toBe(true);
    expect(SCHEMA_VERSION).toBeGreaterThan(0);
  });
});
