import { hbElement, type HbElement } from "@hamboom/shared-types";
import { describe, expect, it } from "vitest";

import { getKind } from "./mapping";
import { createShape } from "./shape";
import { createSticky } from "./sticky";
import {
  createFrame,
  deleteFrameKeepChildren,
  frameChildren,
  moveFrame,
  recomputeFrameMembership,
} from "./frame";

let counter = 0;
function seed() {
  return {
    authorId: "u_1",
    now: 1_753_000_000_000,
    makeId: () => `id${++counter}`,
    random: () => 0.5,
  };
}

/** یک شکل با موقعیت و اندازه‌ی مشخص، برای آزمون عضویت. */
function shapeAt(id: string, x: number, y: number, w = 50, h = 50): HbElement {
  const s = createShape({ shape: "rectangle", x, y, width: w, height: h, ...seed() }).shape;
  return { ...s, id } as HbElement;
}

describe("createFrame", () => {
  it("از schema رد می‌شود", () => {
    const frame = createFrame({ x: 0, y: 0, ...seed() });
    expect(() => hbElement.parse(frame)).not.toThrow();
  });

  it("kind و نوع رندر هر دو frame اند", () => {
    const frame = createFrame({ x: 0, y: 0, ...seed() });
    expect(frame.type).toBe("frame");
    expect(getKind(frame)).toBe("frame");
  });

  it("نام فارسی می‌گیرد", () => {
    const frame = createFrame({ x: 0, y: 0, name: "جلسه هفتگی — هفته ۱۲", ...seed() });
    expect((frame as { name: string }).name).toContain("هفته");
  });

  it("نام پیش‌فرض فارسی است", () => {
    const frame = createFrame({ x: 0, y: 0, ...seed() });
    expect((frame as { name: string }).name).toBe("فریم بدون عنوان");
  });

  it("رنگ در customData ذخیره می‌شود", () => {
    const frame = createFrame({ x: 0, y: 0, color: "#FF0000", ...seed() });
    expect(frame.customData.hb.frame?.color).toBe("#FF0000");
  });
});

describe("recomputeFrameMembership", () => {
  it("★ عنصری که کاملاً داخل فریم است، عضو می‌شود", () => {
    const frame = { ...createFrame({ x: 0, y: 0, width: 400, height: 400, ...seed() }), id: "F" };
    const inside = shapeAt("A", 50, 50);
    const next = recomputeFrameMembership([frame, inside]);
    expect(next.find((e) => e.id === "A")?.frameId).toBe("F");
  });

  it("★ عنصری که بیرون است، عضو نمی‌شود", () => {
    const frame = { ...createFrame({ x: 0, y: 0, width: 400, height: 400, ...seed() }), id: "F" };
    const outside = shapeAt("A", 500, 500);
    const next = recomputeFrameMembership([frame, outside]);
    expect(next.find((e) => e.id === "A")?.frameId).toBeNull();
  });

  it("★ عنصری که فقط نیمی داخل است، عضو نمی‌شود", () => {
    // باید کاملاً داخل باشد، وگرنه حرکت فریم نصف عنصر را جا می‌گذارد.
    const frame = { ...createFrame({ x: 0, y: 0, width: 100, height: 100, ...seed() }), id: "F" };
    const half = shapeAt("A", 80, 80, 50, 50); // تا 130 می‌رود، بیرون از 100
    expect(recomputeFrameMembership([frame, half]).find((e) => e.id === "A")?.frameId).toBeNull();
  });

  it("★ خروج از فریم، frameId را پاک می‌کند", () => {
    const frame = { ...createFrame({ x: 0, y: 0, width: 400, height: 400, ...seed() }), id: "F" };
    const wasInside = { ...shapeAt("A", 500, 500), frameId: "F" } as HbElement;
    expect(
      recomputeFrameMembership([frame, wasInside]).find((e) => e.id === "A")?.frameId,
    ).toBeNull();
  });

  it("★ فریم تودرتو: بالاترین در z برنده است", () => {
    const outer = {
      ...createFrame({ x: 0, y: 0, width: 400, height: 400, index: "a1", ...seed() }),
      id: "OUT",
    };
    const inner = {
      ...createFrame({ x: 50, y: 50, width: 200, height: 200, index: "a5", ...seed() }),
      id: "IN",
    };
    const shape = shapeAt("A", 100, 100);
    const next = recomputeFrameMembership([outer, inner, shape]);
    expect(next.find((e) => e.id === "A")?.frameId).toBe("IN");
  });

  it("فریم عضو فریم دیگر نمی‌شود", () => {
    const outer = {
      ...createFrame({ x: 0, y: 0, width: 400, height: 400, index: "a1", ...seed() }),
      id: "OUT",
    };
    const inner = {
      ...createFrame({ x: 50, y: 50, width: 100, height: 100, index: "a5", ...seed() }),
      id: "IN",
    };
    expect(recomputeFrameMembership([outer, inner]).find((e) => e.id === "IN")?.frameId).toBeNull();
  });

  it("متن مقید مستقل عضو نمی‌شود — عضویتش از ظرفش می‌آید", () => {
    const frame = { ...createFrame({ x: 0, y: 0, width: 400, height: 400, ...seed() }), id: "F" };
    const { container, text } = createSticky({ x: 50, y: 50, ...seed() });
    const next = recomputeFrameMembership([frame, container, text]);
    // ظرف عضو می‌شود، متن مقید نه (frameId اش دست‌نخورده null می‌ماند).
    expect(next.find((e) => e.id === container.id)?.frameId).toBe("F");
    expect(next.find((e) => e.id === text.id)?.frameId).toBeNull();
  });

  it("اگر عضویتی عوض نشود همان آرایه را برمی‌گرداند", () => {
    const frame = { ...createFrame({ x: 0, y: 0, ...seed() }), id: "F" };
    const outside = shapeAt("A", 5000, 5000);
    const input = [frame, outside];
    expect(recomputeFrameMembership(input)).toBe(input);
  });

  it("بدون هیچ فریمی، frameId های باقی‌مانده پاک می‌شوند", () => {
    const orphan = { ...shapeAt("A", 0, 0), frameId: "ghost" } as HbElement;
    expect(recomputeFrameMembership([orphan])[0]?.frameId).toBeNull();
  });
});

describe("moveFrame — حرکت با فرزندان (ADR-026: یک ژست)", () => {
  function scene() {
    const frame = { ...createFrame({ x: 0, y: 0, width: 400, height: 400, ...seed() }), id: "F" };
    const a = { ...shapeAt("A", 50, 50), frameId: "F" } as HbElement;
    const b = { ...shapeAt("B", 150, 150), frameId: "F" } as HbElement;
    const outside = shapeAt("OUT", 900, 900);
    return [frame, a, b, outside];
  }

  it("★ فریم و همه‌ی فرزندان با هم حرکت می‌کنند", () => {
    const next = moveFrame(scene(), "F", 100, 200);
    const byId = new Map(next.map((e) => [e.id, e]));
    expect([byId.get("F")!.x, byId.get("F")!.y]).toEqual([100, 200]);
    expect([byId.get("A")!.x, byId.get("A")!.y]).toEqual([150, 250]);
    expect([byId.get("B")!.x, byId.get("B")!.y]).toEqual([250, 350]);
  });

  it("★ عنصر بیرون فریم حرکت نمی‌کند", () => {
    const next = moveFrame(scene(), "F", 100, 200);
    const out = next.find((e) => e.id === "OUT")!;
    expect([out.x, out.y]).toEqual([900, 900]);
  });

  it("★ متن مقیدِ فرزند هم حرکت می‌کند", () => {
    // استیکی داخل فریم = ظرف (frameId) + متن (containerId، بدون frameId).
    const frame = { ...createFrame({ x: 0, y: 0, width: 400, height: 400, ...seed() }), id: "F" };
    const { container, text } = createSticky({ x: 50, y: 50, ...seed() });
    const boundContainer = { ...container, frameId: "F" } as HbElement;
    const before = { x: text.x, y: text.y };

    const next = moveFrame([frame, boundContainer, text], "F", 100, 100);
    const movedText = next.find((e) => e.id === text.id)!;
    expect([movedText.x, movedText.y]).toEqual([before.x + 100, before.y + 100]);
  });

  it("جابه‌جایی صفر همان آرایه را برمی‌گرداند", () => {
    const input = scene();
    expect(moveFrame(input, "F", 0, 0)).toBe(input);
  });

  it("version همه‌ی متحرک‌ها جلو می‌رود", () => {
    const before = scene();
    const next = moveFrame(before, "F", 10, 10);
    const frameBefore = before.find((e) => e.id === "F")!;
    const frameAfter = next.find((e) => e.id === "F")!;
    expect(frameAfter.version).toBe(frameBefore.version + 1);
  });

  it("★ versionNonce هم عوض می‌شود — وگرنه موتور تغییر را برای undo ثبت نمی‌کند", () => {
    // باگ واقعی که در مرورگر گرفته شد: بدون تغییر versionNonce، حرکت فریم
    // ورودی undo جدا نمی‌سازد و یک Ctrl+Z کل عملیات قبلی را برمی‌گرداند.
    const before = scene();
    const next = moveFrame(before, "F", 10, 10);
    const frameBefore = before.find((e) => e.id === "F")!;
    const frameAfter = next.find((e) => e.id === "F")!;
    expect(frameAfter.versionNonce).not.toBe(frameBefore.versionNonce);
  });

  it("frameChildren فقط فرزندان زنده را می‌دهد", () => {
    const s = scene();
    expect(
      frameChildren(s, "F")
        .map((e) => e.id)
        .sort(),
    ).toEqual(["A", "B"]);
  });
});

describe("deleteFrameKeepChildren — رفتار میرو", () => {
  it("★ فریم حذف نرم می‌شود ولی فرزندان می‌مانند", () => {
    const frame = { ...createFrame({ x: 0, y: 0, ...seed() }), id: "F" };
    const child = { ...shapeAt("A", 50, 50), frameId: "F" } as HbElement;
    const next = deleteFrameKeepChildren([frame, child], "F");

    expect(next.find((e) => e.id === "F")?.isDeleted).toBe(true);
    expect(next.find((e) => e.id === "A")?.isDeleted).toBe(false);
  });

  it("★ فرزندان از فریم آزاد می‌شوند", () => {
    const frame = { ...createFrame({ x: 0, y: 0, ...seed() }), id: "F" };
    const child = { ...shapeAt("A", 50, 50), frameId: "F" } as HbElement;
    expect(
      deleteFrameKeepChildren([frame, child], "F").find((e) => e.id === "A")?.frameId,
    ).toBeNull();
  });
});
