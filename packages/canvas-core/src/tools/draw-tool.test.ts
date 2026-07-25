import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ElementChangeSet, EphemeralPayload } from "../sync/contract";
import { createDrawTool, type DrawStrokeOutbound } from "./draw-tool";

/** موتور ساختگی — کمینه‌ی چیزی که ابزار قلم لازم دارد. */
function fakeApi() {
  let elements: Array<Record<string, unknown>> = [];
  const api = {
    getSceneElements: () => elements,
    getAppState: () => ({
      scrollX: 0,
      scrollY: 0,
      zoom: { value: 1 },
      offsetLeft: 0,
      offsetTop: 0,
      width: 800,
      height: 600,
    }),
    updateScene: (data: { elements?: Array<Record<string, unknown>> }) => {
      if (data.elements) elements = data.elements;
    },
    setActiveTool: () => {},
    setCursor: () => {},
    resetCursor: () => {},
  } as unknown as ExcalidrawImperativeAPI;
  return { api, getElements: () => elements };
}

function fakeOutbound() {
  const ephemeral: Array<EphemeralPayload | null> = [];
  const changes: ElementChangeSet[] = [];
  const outbound: DrawStrokeOutbound = {
    emitEphemeral: (payload) => ephemeral.push(payload),
    emitElementChanges: (change) => changes.push(change),
  };
  return { outbound, ephemeral, changes };
}

/** ریشه‌ی جدا با یک فرزندِ `.excalidraw` به‌عنوان هدفِ رویداد. */
function makeDom() {
  const root = document.createElement("div");
  const canvas = document.createElement("div");
  canvas.className = "excalidraw";
  root.appendChild(canvas);
  return { root, canvas };
}

function pointer(type: string, x: number, y: number) {
  return new MouseEvent(type, {
    clientX: x,
    clientY: y,
    button: 0,
    bubbles: true,
    cancelable: true,
  });
}

describe("createDrawTool — ADR-022: یک ژست، یک تغییرِ ماندگار", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("★ استروکِ ۳۰۰ نقطه‌ای دقیقاً یک emitElementChanges می‌سازد", () => {
    const f = fakeApi();
    const o = fakeOutbound();
    const { root, canvas } = makeDom();
    const tool = createDrawTool({
      api: f.api,
      outbound: o.outbound,
      authorId: "u",
      root,
      ephemeralThrottleMs: 0, // هر move پخش شود تا کثرتِ ephemeral دیده شود
    });
    tool.activate();

    canvas.dispatchEvent(pointer("pointerdown", 100, 100));
    for (let i = 1; i <= 300; i += 1) {
      canvas.dispatchEvent(pointer("pointermove", 100 + i, 100 + (i % 2)));
    }
    canvas.dispatchEvent(pointer("pointerup", 401, 100));

    // ★ قلبِ ADR-022: صدها ephemeral، ولی دقیقاً یک تغییرِ ماندگار.
    expect(o.changes).toHaveLength(1);
    expect(o.ephemeral.length).toBeGreaterThan(100);
    expect(o.ephemeral.at(-1)).toBeNull(); // پایان استروک

    const change = o.changes[0]!;
    expect(change.origin).toBe("local-user");
    expect(change.gestureId).toBeTruthy();
    expect(change.upserted).toHaveLength(1);
    const el = change.upserted[0]!;
    expect(el.type).toBe("freedraw");
    // ساده‌سازی: خیلی کمتر از ۳۰۱ نقطه‌ی خام
    expect((el as unknown as { points: unknown[] }).points.length).toBeLessThan(50);

    // روی صحنه‌ی محلی هم نشست (برای رندر و undo)
    expect(f.getElements()).toHaveLength(1);
  });

  it("★ کلیکِ تنها (بدون حرکت) استروک نیست — هیچ commit نمی‌شود", () => {
    const f = fakeApi();
    const o = fakeOutbound();
    const { root, canvas } = makeDom();
    const tool = createDrawTool({ api: f.api, outbound: o.outbound, authorId: "u", root });
    tool.activate();

    canvas.dispatchEvent(pointer("pointerdown", 50, 50));
    canvas.dispatchEvent(pointer("pointerup", 50, 50));

    expect(o.changes).toHaveLength(0);
    expect(f.getElements()).toHaveLength(0);
    expect(o.ephemeral.at(-1)).toBeNull(); // ephemeral پاک شد
  });

  it("★ وقتی ابزار غیرفعال است، رویداد نادیده گرفته می‌شود", () => {
    const f = fakeApi();
    const o = fakeOutbound();
    const { root, canvas } = makeDom();
    createDrawTool({ api: f.api, outbound: o.outbound, authorId: "u", root });
    // بدون activate

    canvas.dispatchEvent(pointer("pointerdown", 10, 10));
    canvas.dispatchEvent(pointer("pointermove", 20, 20));
    canvas.dispatchEvent(pointer("pointerup", 30, 30));

    expect(o.changes).toHaveLength(0);
    expect(o.ephemeral).toHaveLength(0);
  });

  it("رویدادِ بیرون از بومِ `.excalidraw` نادیده گرفته می‌شود", () => {
    const f = fakeApi();
    const o = fakeOutbound();
    const root = document.createElement("div");
    const outside = document.createElement("div"); // بدون کلاس excalidraw
    root.appendChild(outside);
    const tool = createDrawTool({ api: f.api, outbound: o.outbound, authorId: "u", root });
    tool.activate();

    outside.dispatchEvent(pointer("pointerdown", 10, 10));
    outside.dispatchEvent(pointer("pointerup", 40, 40));
    expect(o.changes).toHaveLength(0);
  });

  it("مختصاتِ commit‌شده از zoom/scroll صحنه پیروی می‌کند", () => {
    const f = fakeApi();
    const o = fakeOutbound();
    const { root, canvas } = makeDom();
    const tool = createDrawTool({ api: f.api, outbound: o.outbound, authorId: "u", root });
    tool.activate();

    // با zoom=1، scroll=0، offset=0 → مختصات صحنه = مختصات کلاینت
    canvas.dispatchEvent(pointer("pointerdown", 100, 200));
    canvas.dispatchEvent(pointer("pointermove", 140, 260));
    canvas.dispatchEvent(pointer("pointerup", 180, 200));

    const el = o.changes[0]!.upserted[0]! as unknown as { x: number; y: number };
    // جعبه‌ی احاطه از x=100..180, y=200..260 → گوشه (100,200)
    expect([el.x, el.y]).toEqual([100, 200]);
  });
});
