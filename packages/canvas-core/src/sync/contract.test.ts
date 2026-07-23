import type { HbElement } from "@hamboom/shared-types";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  EchoLoopError,
  assertEmittable,
  isEmittableOrigin,
  type CanvasInbound,
  type CanvasOutbound,
  type ElementChangeSet,
} from "./contract";
import { LocalSyncAdapter, LocalSyncHub } from "./local-adapter";

/** یک عنصر معتبر حداقلی برای تست. */
function element(id: string, overrides: Partial<HbElement> = {}): HbElement {
  return {
    id,
    type: "rectangle",
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    angle: 0,
    index: "a1",
    frameId: null,
    groupIds: [],
    locked: false,
    strokeColor: "#1a1a1a",
    backgroundColor: "#FFF9B1",
    fillStyle: "solid",
    strokeWidth: 1,
    strokeStyle: "solid",
    roughness: 0,
    opacity: 100,
    roundness: null,
    seed: 1,
    version: 1,
    versionNonce: 1,
    updated: 0,
    isDeleted: false,
    boundElements: null,
    link: null,
    customData: {
      hb: {
        schema: 1,
        kind: "sticky",
        createdBy: "u_1",
        lastEditedBy: "u_1",
        createdAt: 0,
      },
    },
    ...overrides,
  } as HbElement;
}

/** بوم ساختگی — فقط آنچه رسیده را ثبت می‌کند. */
function fakeCanvas() {
  const received: ElementChangeSet[] = [];
  const inbound: CanvasInbound = {
    applyRemoteChanges: (changes) => received.push(changes),
    applyPeers: vi.fn(),
    setConnectionState: vi.fn(),
    setSaveState: vi.fn(),
    setPermissions: vi.fn(),
    replaceDocument: vi.fn(),
    focusOn: vi.fn(),
  };
  return { inbound, received };
}

describe("نگهبان حلقه‌ی echo", () => {
  it("منشأ محلی، undo و system مجازند", () => {
    expect(isEmittableOrigin("local-user")).toBe(true);
    expect(isEmittableOrigin("undo")).toBe(true);
    expect(isEmittableOrigin("system")).toBe(true);
  });

  it("منشأ remote مجاز نیست", () => {
    expect(isEmittableOrigin("remote")).toBe(false);
  });

  it("assertEmittable روی remote خطا می‌دهد", () => {
    expect(() =>
      assertEmittable({ upserted: [], deleted: [], origin: "remote", gestureId: "g1" }),
    ).toThrow(EchoLoopError);
  });

  it("پیام خطا gestureId را دارد تا ردیابی ممکن باشد", () => {
    try {
      assertEmittable({ upserted: [], deleted: [], origin: "remote", gestureId: "g_42" });
      expect.unreachable("باید خطا می‌داد");
    } catch (error) {
      expect((error as Error).message).toContain("g_42");
    }
  });
});

describe("LocalSyncAdapter — همگام‌سازی بین دو کلاینت", () => {
  let hub: LocalSyncHub;

  beforeEach(() => {
    hub = new LocalSyncHub();
  });

  it("تغییر یک کلاینت به کلاینت دیگر می‌رسد", async () => {
    const a = new LocalSyncAdapter({ hub, user: { id: "u_a", displayName: "الف", color: "#f00" } });
    const b = new LocalSyncAdapter({ hub, user: { id: "u_b", displayName: "ب", color: "#0f0" } });

    const canvasA = fakeCanvas();
    const canvasB = fakeCanvas();
    const outA = await a.connect(canvasA.inbound);
    await b.connect(canvasB.inbound);

    outA.emitElementChanges({
      upserted: [element("stk_1")],
      deleted: [],
      origin: "local-user",
      gestureId: "g1",
    });

    expect(canvasB.received).toHaveLength(1);
    expect(canvasB.received[0]?.upserted[0]?.id).toBe("stk_1");
  });

  it("★ فرستنده تغییر خودش را پس نمی‌گیرد", async () => {
    const a = new LocalSyncAdapter({ hub });
    const b = new LocalSyncAdapter({ hub });
    const canvasA = fakeCanvas();
    const outA = await a.connect(canvasA.inbound);
    await b.connect(fakeCanvas().inbound);

    outA.emitElementChanges({ upserted: [element("stk_1")], deleted: [], origin: "local-user" });

    expect(canvasA.received).toHaveLength(0);
  });

  it("★ تغییر رسیده با origin=remote برچسب می‌خورد", async () => {
    const a = new LocalSyncAdapter({ hub });
    const b = new LocalSyncAdapter({ hub });
    const canvasB = fakeCanvas();
    const outA = await a.connect(fakeCanvas().inbound);
    await b.connect(canvasB.inbound);

    outA.emitElementChanges({ upserted: [element("stk_1")], deleted: [], origin: "local-user" });

    expect(canvasB.received[0]?.origin).toBe("remote");
  });

  it("★ اگر بومِ بدرفتار تغییر remote را دوباره emit کند، خطا می‌گیرد — نه حلقه", async () => {
    const a = new LocalSyncAdapter({ hub });
    const b = new LocalSyncAdapter({ hub });
    const outA = await a.connect(fakeCanvas().inbound);

    // بوم B عمداً بد رفتار می‌کند: هرچه می‌رسد را دوباره می‌فرستد.
    let outB: CanvasOutbound | null = null;
    const misbehaving: CanvasInbound = {
      applyRemoteChanges: (changes) => outB?.emitElementChanges(changes),
      applyPeers: vi.fn(),
      setConnectionState: vi.fn(),
      setSaveState: vi.fn(),
      setPermissions: vi.fn(),
      replaceDocument: vi.fn(),
      focusOn: vi.fn(),
    };
    outB = await b.connect(misbehaving);

    // بدون نگهبان، اینجا یک حلقه‌ی بی‌نهایت بین دو کلاینت شروع می‌شد.
    expect(() =>
      outA.emitElementChanges({
        upserted: [element("stk_1")],
        deleted: [],
        origin: "local-user",
      }),
    ).toThrow(EchoLoopError);
  });

  it("کلاینت تازه‌وارد سند فعلی را می‌گیرد", async () => {
    const a = new LocalSyncAdapter({ hub });
    const outA = await a.connect(fakeCanvas().inbound);
    outA.emitElementChanges({ upserted: [element("stk_1")], deleted: [], origin: "local-user" });

    const b = new LocalSyncAdapter({ hub });
    const canvasB = fakeCanvas();
    await b.connect(canvasB.inbound);

    expect(canvasB.inbound.replaceDocument).toHaveBeenCalledWith(
      expect.objectContaining({
        elements: expect.arrayContaining([expect.objectContaining({ id: "stk_1" })]),
      }),
    );
  });

  it("حذف به‌صورت نرم اعمال می‌شود، نه واقعی", async () => {
    const a = new LocalSyncAdapter({ hub });
    const outA = await a.connect(fakeCanvas().inbound);
    outA.emitElementChanges({ upserted: [element("stk_1")], deleted: [], origin: "local-user" });
    outA.emitElementChanges({ upserted: [], deleted: ["stk_1"], origin: "local-user" });

    const snapshot = hub.snapshot();
    // CRDT و undo هر دو به ماندن عنصر نیاز دارند.
    expect(snapshot.elements).toHaveLength(1);
    expect(snapshot.elements[0]?.isDeleted).toBe(true);
  });

  it("وضعیت ذخیره از saving به saved می‌رود", async () => {
    const a = new LocalSyncAdapter({ hub });
    const canvasA = fakeCanvas();
    const outA = await a.connect(canvasA.inbound);
    outA.emitElementChanges({ upserted: [element("stk_1")], deleted: [], origin: "local-user" });

    const calls = vi.mocked(canvasA.inbound.setSaveState).mock.calls.map(([s]) => s.status);
    expect(calls).toContain("saving");
    expect(calls.at(-1)).toBe("saved");
  });

  it("حضور همکاران به بقیه اطلاع داده می‌شود", async () => {
    const a = new LocalSyncAdapter({ hub, user: { id: "u_a", displayName: "الف", color: "#f00" } });
    const canvasA = fakeCanvas();
    await a.connect(canvasA.inbound);

    const b = new LocalSyncAdapter({ hub, user: { id: "u_b", displayName: "ب", color: "#0f0" } });
    await b.connect(fakeCanvas().inbound);

    const lastPeers = vi.mocked(canvasA.inbound.applyPeers).mock.calls.at(-1)?.[0];
    expect(lastPeers?.map((p) => p.user.displayName)).toEqual(["ب"]);
  });

  it("داده‌ی ephemeral وارد سند نمی‌شود (ADR-022)", async () => {
    const a = new LocalSyncAdapter({ hub });
    const outA = await a.connect(fakeCanvas().inbound);

    outA.emitEphemeral({
      kind: "draw-stroke",
      points: [
        [0, 0],
        [1, 1],
      ],
      color: "#000",
      width: 2,
    });

    expect(hub.snapshot().elements).toHaveLength(0);
  });

  it("بعد از disconnect، تغییرات دیگران نمی‌رسد", async () => {
    const a = new LocalSyncAdapter({ hub });
    const b = new LocalSyncAdapter({ hub });
    const canvasB = fakeCanvas();
    const outA = await a.connect(fakeCanvas().inbound);
    await b.connect(canvasB.inbound);

    b.disconnect();
    outA.emitElementChanges({ upserted: [element("stk_1")], deleted: [], origin: "local-user" });

    expect(canvasB.received).toHaveLength(0);
  });
});
