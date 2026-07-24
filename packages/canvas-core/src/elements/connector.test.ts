import { hbElement, type HbElement, type HbLinearElement } from "@hamboom/shared-types";
import { describe, expect, it } from "vitest";

import { getKind } from "./mapping";
import { createConnector, rerouteConnector } from "./connector";
import type { Box } from "./connector-routing";

let counter = 0;
function deterministic() {
  counter = 0;
  return {
    authorId: "u_1",
    now: 1_753_000_000_000,
    makeId: () => `id${++counter}`,
    random: () => 0.5,
  };
}

const box = (x: number, y: number, w = 100, h = 100): Box => ({ x, y, width: w, height: h });
const asLinear = (element: HbElement) => element as HbLinearElement;

describe("createConnector", () => {
  it("از schema رد می‌شود", () => {
    const c = createConnector({
      start: { elementId: "a", box: box(0, 0) },
      end: { elementId: "b", box: box(300, 0) },
      ...deterministic(),
    });
    expect(() => hbElement.parse(c)).not.toThrow();
  });

  it("kind محصولی connector است، نوع رندر arrow", () => {
    const c = createConnector({
      start: { box: box(0, 0) },
      end: { box: box(300, 0) },
      ...deterministic(),
    });
    expect(c.type).toBe("arrow");
    expect(getKind(c)).toBe("connector");
  });

  it("★ به دو عنصر bind می‌شود وقتی elementId داده شود", () => {
    const c = asLinear(
      createConnector({
        start: { elementId: "stk_a", box: box(0, 0) },
        end: { elementId: "stk_b", box: box(300, 0) },
        ...deterministic(),
      }),
    );
    expect(c.startBinding?.elementId).toBe("stk_a");
    expect(c.endBinding?.elementId).toBe("stk_b");
  });

  it("سرِ آزاد binding ندارد", () => {
    const c = asLinear(
      createConnector({
        start: { elementId: "stk_a", box: box(0, 0) },
        end: { box: { x: 500, y: 500 } },
        ...deterministic(),
      }),
    );
    expect(c.startBinding).not.toBeNull();
    expect(c.endBinding).toBeNull();
  });

  it("★ points[0] همیشه [0,0] است — قرارداد موتور برای عنصر خطی", () => {
    const c = asLinear(
      createConnector({
        start: { box: box(0, 0) },
        end: { box: box(300, 300) },
        ...deterministic(),
      }),
    );
    expect(c.points[0]).toEqual([0, 0]);
  });

  it("x/y عنصر برابر نقطه‌ی اول مسیر مطلق است", () => {
    // لبه‌ی راست جعبه‌ی (0,0,100,100) به سمت (350,50) → (100,50).
    const c = createConnector({
      start: { box: box(0, 0) },
      end: { box: box(300, 0) },
      ...deterministic(),
    });
    expect([c.x, c.y]).toEqual([100, 50]);
  });

  it("سبک پیش‌فرض elbow است و elbowed را ست می‌کند", () => {
    const c = asLinear(
      createConnector({
        start: { box: box(0, 0) },
        end: { box: box(300, 300) },
        ...deterministic(),
      }),
    );
    expect(c.customData.hb.connector?.style).toBe("elbow");
    expect(c.elbowed).toBe(true);
  });

  it("سبک straight، elbowed را false می‌کند", () => {
    const c = asLinear(
      createConnector({
        start: { box: box(0, 0) },
        end: { box: box(300, 0) },
        style: "straight",
        ...deterministic(),
      }),
    );
    expect(c.elbowed).toBe(false);
    expect(c.points).toHaveLength(2);
  });

  it("فقط انتها پیکان دارد", () => {
    const c = asLinear(
      createConnector({ start: { box: box(0, 0) }, end: { box: box(300, 0) }, ...deterministic() }),
    );
    expect(c.startArrowhead).toBeNull();
    expect(c.endArrowhead).toBe("arrow");
  });

  it("برچسب در customData ذخیره می‌شود", () => {
    const c = createConnector({
      start: { box: box(0, 0) },
      end: { box: box(300, 0) },
      label: "وابسته به",
      ...deterministic(),
    });
    expect(c.customData.hb.connector?.label).toBe("وابسته به");
  });

  it("با ورودی یکسان خروجی یکسان می‌دهد", () => {
    const opts = {
      start: { elementId: "a", box: box(1, 2) },
      end: { elementId: "b", box: box(311, 217) },
      style: "elbow" as const,
    };
    const a = createConnector({ ...opts, ...deterministic() });
    const b = createConnector({ ...opts, ...deterministic() });
    expect(a).toEqual(b);
  });
});

describe("rerouteConnector — مسیر مشتق‌شده", () => {
  it("★ وقتی یک سر جابه‌جا می‌شود، مسیر جدید می‌دهد", () => {
    const c = createConnector({
      start: { elementId: "a", box: box(0, 0) },
      end: { elementId: "b", box: box(300, 0) },
      style: "straight",
      ...deterministic(),
    });
    const moved = rerouteConnector(c, box(0, 0), box(300, 400));
    // حالا مقصد پایین رفته، پس نقطه‌ی دوم عوض می‌شود.
    expect(moved.points).not.toEqual((c as HbLinearElement).points);
  });

  it("★ همان جابه‌جایی همیشه همان مسیر — قطعی بین کلاینت‌ها", () => {
    const c = createConnector({
      start: { elementId: "a", box: box(0, 0) },
      end: { elementId: "b", box: box(300, 0) },
      ...deterministic(),
    });
    const first = JSON.stringify(rerouteConnector(c, box(50, 60), box(400, 380)));
    for (let i = 0; i < 50; i++) {
      expect(JSON.stringify(rerouteConnector(c, box(50, 60), box(400, 380)))).toBe(first);
    }
  });

  it("سبک را از customData حفظ می‌کند", () => {
    const straight = createConnector({
      start: { box: box(0, 0) },
      end: { box: box(300, 0) },
      style: "straight",
      ...deterministic(),
    });
    // straight همیشه دو نقطه دارد، حتی بعد از reroute.
    expect(rerouteConnector(straight, box(0, 0), box(300, 400)).points).toHaveLength(2);
  });

  it("points[0] بعد از reroute هم [0,0] است", () => {
    const c = createConnector({
      start: { box: box(0, 0) },
      end: { box: box(300, 0) },
      ...deterministic(),
    });
    expect(rerouteConnector(c, box(10, 20), box(400, 500)).points[0]).toEqual([0, 0]);
  });
});
