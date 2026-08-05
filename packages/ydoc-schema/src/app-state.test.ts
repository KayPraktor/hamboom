import { hbAppState } from "@hamboom/shared-types";
import type * as Y from "yjs";
import { describe, expect, it } from "vitest";

import {
  DEFAULT_APP_STATE,
  readAppState,
  SHARED_APP_STATE_KEYS,
  writeAppState,
} from "./app-state.ts";
import { boardRoots, createBoardDoc, readDocument } from "./doc.ts";
import { twoClients } from "./test-fixtures.ts";

describe("وضعیتِ مشترکِ بورد", () => {
  it("سندِ خالی وضعیتِ کاملِ معتبر می‌دهد، نه `undefined`", () => {
    const state = readAppState(boardRoots(createBoardDoc()).appState);
    expect(() => hbAppState.parse(state)).not.toThrow();
    expect(state).toEqual(DEFAULT_APP_STATE);
  });

  it("★ patch است نه شیءِ کامل — بقیه‌ی تنظیمات پاک نمی‌شوند", () => {
    // کاربر «گرید را روشن کرد» می‌فرستد، نه کلِ وضعیت. اگر مثلِ عنصر prune
    // می‌شد، هر تغییرِ کوچک بقیه‌ی تنظیماتِ بورد را پاک می‌کرد.
    const doc = createBoardDoc();
    writeAppState(boardRoots(doc).appState, { viewBackgroundColor: "#1e1e1e" });
    writeAppState(boardRoots(doc).appState, { gridEnabled: true });

    const state = readAppState(boardRoots(doc).appState);
    expect(state.viewBackgroundColor).toBe("#1e1e1e");
    expect(state.gridEnabled).toBe(true);
    expect(state.snapToObjects).toBe(DEFAULT_APP_STATE.snapToObjects);
  });

  it("در `readDocument` هم همان وضعیت می‌آید", () => {
    const doc = createBoardDoc();
    writeAppState(boardRoots(doc).appState, { gridEnabled: true });
    expect(readDocument(doc).appState.gridEnabled).toBe(true);
  });

  it("نوشتنِ مقدارِ بدونِ تغییر = صفر update", () => {
    const doc = createBoardDoc();
    writeAppState(boardRoots(doc).appState, { gridEnabled: true });

    let updates = 0;
    doc.on("update", () => updates++);
    writeAppState(boardRoots(doc).appState, { gridEnabled: true });
    expect(updates).toBe(0);
  });

  it("`frameRendering` تودرتو per-property ادغام می‌شود", () => {
    const { a, b, rootsOf, sync } = twoClients();
    writeAppState(rootsOf(a).appState, { frameRendering: DEFAULT_APP_STATE.frameRendering });
    sync();

    writeAppState(rootsOf(a).appState, {
      frameRendering: { ...DEFAULT_APP_STATE.frameRendering, name: false },
    });
    writeAppState(rootsOf(b).appState, {
      frameRendering: { ...DEFAULT_APP_STATE.frameRendering, outline: false },
    });
    sync();

    for (const doc of [a, b]) {
      const { frameRendering } = readAppState(rootsOf(doc).appState);
      expect(frameRendering.name).toBe(false);
      expect(frameRendering.outline).toBe(false);
      expect(frameRendering.enabled).toBe(true);
    }
  });
});

/**
 * ★★ خط قرمز: **وضعیتِ شخصی داخلِ سند نمی‌رود.**
 *
 * `scrollX`/`zoom`/`selectedElementIds` وضعیتِ یک کاربرند، نه وضعیتِ بورد. اگر
 * داخل سند بنشینند، هر بار که یکی اسکرول کند نمای **همه** می‌پرد — و چون CRDT
 * است، همگرا هم می‌شود: همه به یک نما می‌رسند و هیچ‌کس نمی‌فهمد چرا. جایشان
 * کانالِ awareness است ([ADR-022](../../../ARCHITECTURE_DECISIONS.md#adr-022)).
 */
describe("★★ نگهبانِ وضعیتِ شخصی", () => {
  it("فهرستِ کلیدهای مجاز دقیقاً همان چیزی است که PLAN ۷٫۱ می‌گوید", () => {
    expect([...SHARED_APP_STATE_KEYS].sort()).toEqual([
      "frameRendering",
      "gridEnabled",
      "gridSize",
      "snapToObjects",
      "viewBackgroundColor",
    ]);
    // ★ و از خودِ schema می‌آید، نه یک کپیِ دستی — پس اگر `shared-types` کلیدی
    //   اضافه کند، این نگهبان خودبه‌خود دنبالش می‌آید.
    expect([...SHARED_APP_STATE_KEYS].sort()).toEqual(Object.keys(hbAppState.shape).sort());
  });

  for (const key of ["scrollX", "scrollY", "zoom", "selectedElementIds"]) {
    it(`نوشتنِ «${key}» خطا می‌دهد، نه سکوت`, () => {
      const doc = createBoardDoc();
      // سکوت یعنی یک `zoom: 3` که هیچ اثری ندارد و کسی که نوشته ساعت‌ها
      // دنبالِ دلیلش می‌گردد.
      expect(() => writeAppState(boardRoots(doc).appState, { [key]: 3 })).toThrow(/awareness/);
      expect(boardRoots(doc).appState.has(key)).toBe(false);
    });
  }

  it("★ حتی اگر کلاینتِ بدرفتار مستقیم بنویسد، خواندن نادیده‌اش می‌گیرد", () => {
    // `writeAppState` جلوی کدِ **خودمان** را می‌گیرد؛ این جلوی کلاینتِ قدیمی یا
    // دست‌کاری‌شده را. بدونِ این، نمای کاربر همچنان می‌پرید.
    const doc = createBoardDoc();
    const root = boardRoots(doc).appState as unknown as Y.Map<unknown>;
    root.set("scrollX", 500);
    root.set("zoom", 3);
    root.set("gridEnabled", true);

    const state = readAppState(boardRoots(doc).appState);
    expect(Object.hasOwn(state, "scrollX")).toBe(false);
    expect(Object.hasOwn(state, "zoom")).toBe(false);
    expect(state.gridEnabled).toBe(true);
    expect(() => hbAppState.parse(state)).not.toThrow();
  });
});
