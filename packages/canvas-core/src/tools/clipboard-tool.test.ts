import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import type { HbElement } from "@hamboom/shared-types";
import { describe, expect, it } from "vitest";

import { fromExcalidraw, toExcalidraw } from "../elements/mapping";
import { createShape } from "../elements/shape";
import { createClipboardTool } from "./clipboard-tool";

let n = 0;
function hbShape(id: string, x = 0, y = 0): HbElement {
  const s = createShape({
    shape: "rectangle",
    x,
    y,
    width: 20,
    height: 20,
    authorId: "u",
    makeId: () => `s${++n}`,
    random: () => 0.5,
    now: 1_753_000_000_000,
  }).shape;
  return { ...s, id };
}

function fakeApi(hbElements: HbElement[]) {
  let scene: unknown[] = hbElements.map((e) => toExcalidraw(e));
  let selected: Record<string, boolean> = {};
  const api = {
    getSceneElements: () => scene,
    getAppState: () => ({
      selectedElementIds: selected,
      offsetLeft: 0,
      offsetTop: 0,
      width: 800,
      height: 600,
      scrollX: 0,
      scrollY: 0,
      zoom: { value: 1 },
    }),
    updateScene: (d: {
      elements?: unknown[];
      appState?: { selectedElementIds?: Record<string, boolean> };
    }) => {
      if (d.elements) scene = d.elements;
      if (d.appState?.selectedElementIds) selected = d.appState.selectedElementIds;
    },
  } as unknown as ExcalidrawImperativeAPI;
  return {
    api,
    select: (ids: string[]) => {
      selected = Object.fromEntries(ids.map((i) => [i, true]));
    },
    liveCount: () => (scene as { isDeleted?: boolean }[]).filter((e) => !e.isDeleted).length,
    sceneHb: () => scene.map((e) => fromExcalidraw(e as never)),
  };
}

describe("clipboard-tool — کپی/برش/پیستِ داخلی (روی cloneElements/deleteElements)", () => {
  it("★ copySelection انتخاب را می‌گیرد؛ بدون انتخاب false", () => {
    const f = fakeApi([hbShape("A")]);
    const clip = createClipboardTool({ api: f.api, authorId: "u" });
    expect(clip.copySelection()).toBe(false); // بدون انتخاب
    f.select(["A"]);
    expect(clip.copySelection()).toBe(true);
    expect(clip.hasClip()).toBe(true);
    clip.destroy();
  });

  it("★ pasteFromStore کلون را با id تازه و آفست ۱۶ اضافه می‌کند", () => {
    const f = fakeApi([hbShape("A", 100, 100)]);
    const clip = createClipboardTool({ api: f.api, authorId: "u" });
    f.select(["A"]);
    clip.copySelection();
    clip.pasteFromStore();
    expect(f.liveCount()).toBe(2); // اصل + کلون
    const clone = f.sceneHb().find((e) => e.id !== "A")!;
    expect(clone.x).toBe(116);
    expect(clone.y).toBe(116);
    clip.destroy();
  });

  it("★ cutSelection کپی می‌کند و انتخاب را حذف می‌کند؛ سپس paste برش‌خورده را برمی‌گرداند", () => {
    const f = fakeApi([hbShape("A", 0, 0)]);
    const clip = createClipboardTool({ api: f.api, authorId: "u" });
    f.select(["A"]);
    clip.cutSelection();
    expect(f.liveCount()).toBe(0); // A حذفِ نرم شد
    expect(clip.hasClip()).toBe(true);
    clip.pasteFromStore();
    expect(f.liveCount()).toBe(1); // برش‌خورده برگشت
    clip.destroy();
  });

  it("paste دوباره آبشاری آفست می‌شود (روی هم نمی‌افتد)", () => {
    const f = fakeApi([hbShape("A", 0, 0)]);
    const clip = createClipboardTool({ api: f.api, authorId: "u" });
    f.select(["A"]);
    clip.copySelection();
    clip.pasteFromStore(); // +16
    clip.pasteFromStore(); // +32
    const xs = f
      .sceneHb()
      .filter((e) => e.id !== "A")
      .map((e) => e.x)
      .sort((a, b) => a - b);
    expect(xs).toEqual([16, 32]);
    clip.destroy();
  });
});
