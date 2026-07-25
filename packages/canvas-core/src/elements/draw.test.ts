import { hbElement } from "@hamboom/shared-types";
import { describe, expect, it } from "vitest";

import { getKind } from "./mapping";
import { createDraw, simplifyStroke, type StrokePoint } from "./draw";

let counter = 0;
function seed() {
  return {
    authorId: "u_1",
    now: 1_753_000_000_000,
    makeId: () => `id${++counter}`,
    random: () => 0.5,
  };
}

describe("simplifyStroke (RDP)", () => {
  it("★ نقاطِ ≤۲ دست‌نخورده (کپی) برمی‌گردند", () => {
    const one: StrokePoint[] = [[1, 2]];
    const two: StrokePoint[] = [
      [0, 0],
      [3, 4],
    ];
    expect(simplifyStroke(one)).toEqual(one);
    expect(simplifyStroke(two)).toEqual(two);
    expect(simplifyStroke(two)).not.toBe(two); // کپی، نه همان مرجع
  });

  it("★ نقاطِ روی یک خط راست به دو سر جمع می‌شوند", () => {
    const line: StrokePoint[] = [
      [0, 0],
      [1, 0],
      [2, 0],
      [3, 0],
      [4, 0],
    ];
    expect(simplifyStroke(line, 0.5)).toEqual([
      [0, 0],
      [4, 0],
    ]);
  });

  it("★ قله‌ی بالاتر از آستانه حفظ می‌شود", () => {
    const peak: StrokePoint[] = [
      [0, 0],
      [2, 3],
      [4, 0],
    ];
    // فاصله‌ی قله از خطِ دو سر ۳ است > ۱
    expect(simplifyStroke(peak, 1)).toEqual([
      [0, 0],
      [2, 3],
      [4, 0],
    ]);
  });

  it("★ لرزشِ کمتر از آستانه حذف می‌شود", () => {
    const wobble: StrokePoint[] = [
      [0, 0],
      [2, 0.5],
      [4, 0],
    ];
    expect(simplifyStroke(wobble, 1)).toEqual([
      [0, 0],
      [4, 0],
    ]);
  });

  it("★ استروکِ بزرگ به‌شدت کوچک می‌شود ولی دو سر می‌مانند", () => {
    const many: StrokePoint[] = Array.from(
      { length: 300 },
      (_, i) => [i, (i % 2) * 0.2] as StrokePoint,
    );
    const simplified = simplifyStroke(many, 1);
    expect(simplified.length).toBeLessThan(10);
    expect(simplified[0]).toEqual([0, 0]);
    expect(simplified.at(-1)).toEqual([299, (299 % 2) * 0.2]);
  });

  it("آستانه‌ی کوچک‌تر نقاط بیشتری نگه می‌دارد", () => {
    const zig: StrokePoint[] = [
      [0, 0],
      [1, 1],
      [2, 0],
      [3, 1],
      [4, 0],
    ];
    expect(simplifyStroke(zig, 2).length).toBeLessThanOrEqual(simplifyStroke(zig, 0.1).length);
  });
});

describe("createDraw", () => {
  it("★ از schema رد می‌شود", () => {
    const el = createDraw({
      points: [
        [0, 0],
        [10, 10],
      ],
      ...seed(),
    });
    expect(() => hbElement.parse(el)).not.toThrow();
  });

  it("kind = draw و نوع رندر = freedraw", () => {
    const el = createDraw({
      points: [
        [0, 0],
        [5, 5],
      ],
      ...seed(),
    });
    expect(el.type).toBe("freedraw");
    expect(getKind(el)).toBe("draw");
  });

  it("★ x/y گوشه‌ی جعبه‌ی احاطه و points نسبی‌اند", () => {
    const el = createDraw({
      points: [
        [10, 20],
        [30, 40],
        [50, 20],
      ],
      ...seed(),
    }) as unknown as { x: number; y: number; width: number; height: number; points: StrokePoint[] };
    expect([el.x, el.y]).toEqual([10, 20]);
    expect([el.width, el.height]).toEqual([40, 20]);
    expect(el.points).toEqual([
      [0, 0],
      [20, 20],
      [40, 0],
    ]);
  });

  it("★ بدون فشار → simulatePressure روشن است", () => {
    const el = createDraw({
      points: [
        [0, 0],
        [5, 5],
      ],
      ...seed(),
    }) as unknown as {
      simulatePressure: boolean;
      pressures: number[];
    };
    expect(el.simulatePressure).toBe(true);
    expect(el.pressures).toEqual([]);
  });

  it("با فشار داده‌شده → simulatePressure خاموش", () => {
    const el = createDraw({
      points: [
        [0, 0],
        [5, 5],
      ],
      pressures: [0.5, 0.7],
      ...seed(),
    }) as unknown as { simulatePressure: boolean };
    expect(el.simulatePressure).toBe(false);
  });

  it("حاشیه پیش‌فرض جوهرِ تیره و پس‌زمینه شفاف", () => {
    const el = createDraw({
      points: [
        [0, 0],
        [5, 5],
      ],
      ...seed(),
    });
    expect(el.strokeColor).toBe("#1A1A1A");
    expect(el.backgroundColor).toBe("transparent");
  });

  it("استروک بدون نقطه خطا می‌دهد", () => {
    expect(() => createDraw({ points: [], ...seed() })).toThrow();
  });
});
