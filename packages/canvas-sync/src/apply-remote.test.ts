/**
 * @vitest-environment jsdom
 *
 * ⚠️ jsdom اینجا فقط برای بارگذاریِ `canvas-core` است. **undo در jsdom وجود
 * ندارد**، پس ادعای اصلیِ گام ۳٫۲ («سه بار Ctrl+Z کارِ همتا را برنمی‌گرداند»)
 * در مرورگرِ واقعی آزموده می‌شود: [`e2e/undo-isolation.spec.ts`](../e2e/undo-isolation.spec.ts).
 * چیزی که اینجا آزموده می‌شود منطقِ ادغام و **پرچمِ `captureUpdate`** است.
 */
import { createSticky } from "@hamboom/canvas-core";
import type { CanvasDocument, ElementChangeSet } from "@hamboom/canvas-core/sync";
import type { HbElement } from "@hamboom/shared-types";
import { describe, expect, it, vi } from "vitest";

import { applyRemoteChangesToScene, replaceSceneDocument, type CanvasApi } from "./apply-remote.ts";
import { createCanvasBinding } from "./canvas-binding.ts";

const seed = {
  makeId: (() => {
    let n = 0;
    return () => `el_${(n++).toString().padStart(3, "0")}`;
  })(),
  random: () => 0.5,
  now: 1,
};

function sticky(overrides: Partial<HbElement> = {}): HbElement {
  const made = createSticky({ ...seed, x: 0, y: 0, authorId: "u_test" });
  return { ...made.container, ...overrides } as HbElement;
}

/** موتورِ ساختگی — فقط چیزی که این مسیر لمس می‌کند. */
function fakeApi(initial: unknown[] = []) {
  let scene = [...initial];
  const updateScene = vi.fn((payload: { elements?: unknown[] }) => {
    if (payload.elements) scene = [...payload.elements];
  });
  const api = {
    getSceneElementsIncludingDeleted: () => scene,
    getSceneElements: () => scene.filter((el) => !(el as { isDeleted?: boolean }).isDeleted),
    updateScene,
  } as unknown as CanvasApi;
  return { api, updateScene, scene: () => scene };
}

/** آرگومانِ آخرین `updateScene`. */
function lastCall(updateScene: ReturnType<typeof vi.fn>) {
  return updateScene.mock.calls.at(-1)?.[0] as {
    elements: Array<{ id: string; isDeleted?: boolean }>;
    captureUpdate: string;
  };
}

describe("★★ پرچمِ captureUpdate — قلبِ گام ۳٫۲", () => {
  it("تغییرِ remote با `NEVER` نوشته می‌شود، نه `IMMEDIATELY`", () => {
    // با `IMMEDIATELY` کارِ کاربرِ دیگر در undo stackِ **محلی** می‌نشیند و
    // `Ctrl+Z` این کاربر کارِ او را برمی‌گرداند (ADR-026 + ADR-012).
    const { api, updateScene } = fakeApi();
    applyRemoteChangesToScene(api, {
      upserted: [sticky()],
      deleted: [],
      origin: "remote",
    });

    expect(lastCall(updateScene).captureUpdate).toBe("NEVER");
  });

  it("★ بارگذاریِ سند هم `NEVER` است", () => {
    // اگر ورودیِ undo می‌ساخت، اولین `Ctrl+Z`ِ کاربر **کلِ بورد را پاک می‌کرد**.
    const { api, updateScene } = fakeApi();
    const document: CanvasDocument = {
      elements: [sticky()],
      assets: [],
      appState: {
        viewBackgroundColor: "#ffffff",
        gridSize: 20,
        gridEnabled: false,
        snapToObjects: true,
        frameRendering: { enabled: true, name: true, outline: true, clip: true },
      },
    };
    replaceSceneDocument(api, document);

    expect(lastCall(updateScene).captureUpdate).toBe("NEVER");
  });
});

describe("ادغام در صحنه‌ی فعلی", () => {
  it("عنصرِ تازه اضافه می‌شود و قبلی‌ها می‌مانند", () => {
    const existing = sticky({ id: "old", index: "a1" });
    const { api, updateScene } = fakeApi([existing]);

    applyRemoteChangesToScene(api, {
      upserted: [sticky({ id: "new", index: "a2" })],
      deleted: [],
      origin: "remote",
    });

    expect(lastCall(updateScene).elements.map((el) => el.id)).toEqual(["old", "new"]);
  });

  it("عنصرِ موجود جایگزین می‌شود، نه تکرار", () => {
    const { api, updateScene } = fakeApi([sticky({ id: "stk", index: "a1", x: 0 })]);

    applyRemoteChangesToScene(api, {
      upserted: [sticky({ id: "stk", index: "a1", x: 640 })],
      deleted: [],
      origin: "remote",
    });

    const elements = lastCall(updateScene).elements as Array<{ id: string; x: number }>;
    expect(elements).toHaveLength(1);
    expect(elements[0]?.x).toBe(640);
  });

  it("★ مبنا **شاملِ حذف‌شده‌ها** است", () => {
    // `getSceneElements()` حذف‌شده‌ها را فیلتر می‌کند. اگر مبنا آن بود، هر
    // تغییرِ remote عناصرِ حذفِ نرم‌شده را از صحنه می‌انداخت و undoِ حذفِ همتا
    // چیزی برای برگرداندن نداشت.
    const removed = { ...sticky({ id: "gone", index: "a1" }), isDeleted: true };
    const { api, updateScene } = fakeApi([removed]);

    applyRemoteChangesToScene(api, {
      upserted: [sticky({ id: "fresh", index: "a2" })],
      deleted: [],
      origin: "remote",
    });

    expect(lastCall(updateScene).elements.map((el) => el.id)).toContain("gone");
  });

  it("حذف، `isDeleted` را روشن می‌کند و عنصر را نمی‌اندازد", () => {
    const { api, updateScene } = fakeApi([sticky({ id: "stk", index: "a1" })]);

    applyRemoteChangesToScene(api, { upserted: [], deleted: ["stk"], origin: "remote" });

    const elements = lastCall(updateScene).elements;
    expect(elements).toHaveLength(1);
    expect(elements[0]?.isDeleted).toBe(true);
  });

  it("حذفِ عنصری که در صحنه نیست، چیزی نمی‌سازد", () => {
    const { api, updateScene } = fakeApi([sticky({ id: "stk", index: "a1" })]);
    applyRemoteChangesToScene(api, { upserted: [], deleted: ["ghost"], origin: "remote" });
    expect(lastCall(updateScene).elements.map((el) => el.id)).toEqual(["stk"]);
  });

  it("★ ترتیبِ آرایه با `index` هم‌راستا می‌مانَد", () => {
    // اگر ترتیبِ آرایه و `index` با هم نخوانند، عنصرِ تازه‌رسیده‌ی همتا تا اولین
    // بازچینش روی همه‌چیز می‌نشیند.
    const { api, updateScene } = fakeApi([sticky({ id: "top", index: "a9" })]);

    applyRemoteChangesToScene(api, {
      upserted: [sticky({ id: "bottom", index: "a1" })],
      deleted: [],
      origin: "remote",
    });

    expect(lastCall(updateScene).elements.map((el) => el.id)).toEqual(["bottom", "top"]);
  });

  it("`replaceDocument` صحنه را کامل عوض می‌کند", () => {
    const { api, updateScene } = fakeApi([sticky({ id: "stale", index: "a1" })]);
    replaceSceneDocument(api, {
      elements: [sticky({ id: "fresh", index: "a1" })],
      assets: [],
      appState: {
        viewBackgroundColor: "#ffffff",
        gridSize: 20,
        gridEnabled: false,
        snapToObjects: true,
        frameRendering: { enabled: true, name: true, outline: true, clip: true },
      },
    });

    expect(lastCall(updateScene).elements.map((el) => el.id)).toEqual(["fresh"]);
  });
});

describe("`createCanvasBinding`", () => {
  it("دو متدِ نوشتن روی صحنه پیاده‌اند و بقیه به رابط می‌روند", () => {
    const { api, updateScene } = fakeApi();
    const setSaveState = vi.fn();
    const applyPeers = vi.fn();
    const inbound = createCanvasBinding({ api, ui: { setSaveState, applyPeers } });

    const changes: ElementChangeSet = { upserted: [sticky()], deleted: [], origin: "remote" };
    inbound.applyRemoteChanges(changes);
    expect(lastCall(updateScene).captureUpdate).toBe("NEVER");

    inbound.setSaveState({ status: "saving" });
    expect(setSaveState).toHaveBeenCalledWith({ status: "saving" });

    inbound.applyPeers([]);
    expect(applyPeers).toHaveBeenCalledWith([]);
  });

  it("نبودِ callbackِ رابط خطا نمی‌دهد", () => {
    const { api } = fakeApi();
    const inbound = createCanvasBinding({ api });
    expect(() => inbound.setConnectionState({ status: "connecting" })).not.toThrow();
    expect(() => inbound.focusOn({ kind: "element", id: "x" })).not.toThrow();
  });
});
