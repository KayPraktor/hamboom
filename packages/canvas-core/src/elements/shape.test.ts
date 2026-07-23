import { hbElement, type HbElement, type HbTextElement } from "@hamboom/shared-types";
import { describe, expect, it } from "vitest";

import { HB_SIZE, HB_UI_COLORS } from "../theme/tokens";
import { getKind } from "./mapping";
import { createShape, type HbShapeKind } from "./shape";
import { createSticky } from "./sticky";

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

const SHAPES: HbShapeKind[] = ["rectangle", "ellipse", "diamond"];

describe("createShape — هر سه شکل", () => {
  it.each(SHAPES)("%s ساخته می‌شود و از schema رد می‌شود", (shape) => {
    const { elements } = createShape({ shape, x: 0, y: 0, ...deterministic() });
    for (const element of elements) expect(() => hbElement.parse(element)).not.toThrow();
  });

  it.each(SHAPES)("%s نوع درست را می‌گیرد", (shape) => {
    expect(createShape({ shape, x: 0, y: 0, ...deterministic() }).shape.type).toBe(shape);
  });

  it("همه‌شان kind محصولی shape دارند", () => {
    for (const shape of SHAPES) {
      expect(getKind(createShape({ shape, x: 0, y: 0, ...deterministic() }).shape)).toBe("shape");
    }
  });

  it("اندازه‌ی پیش‌فرض از توکن می‌آید و قابل override است", () => {
    const auto = createShape({ shape: "rectangle", x: 0, y: 0, ...deterministic() }).shape;
    expect(auto.width).toBe(HB_SIZE.shape.width);

    const custom = createShape({
      shape: "rectangle",
      x: 0,
      y: 0,
      width: 500,
      height: 300,
      ...deterministic(),
    }).shape;
    expect([custom.width, custom.height]).toEqual([500, 300]);
  });

  it("roughness صفر است — استایل تمیز", () => {
    for (const shape of SHAPES) {
      expect(createShape({ shape, x: 0, y: 0, ...deterministic() }).shape.roughness).toBe(0);
    }
  });

  it("فقط مستطیل گوشه‌ی گرد می‌گیرد", () => {
    expect(
      createShape({ shape: "rectangle", x: 0, y: 0, ...deterministic() }).shape.roundness,
    ).not.toBeNull();
    expect(
      createShape({ shape: "ellipse", x: 0, y: 0, ...deterministic() }).shape.roundness,
    ).toBeNull();
    expect(
      createShape({ shape: "diamond", x: 0, y: 0, ...deterministic() }).shape.roundness,
    ).toBeNull();
  });
});

describe("★ تفاوت شکل با استیکی (ADR-010)", () => {
  it("هر دو rectangle اند ولی kind متفاوتی دارند", () => {
    const shape = createShape({ shape: "rectangle", x: 0, y: 0, ...deterministic() }).shape;
    const sticky = createSticky({ x: 0, y: 0, ...deterministic() }).container;

    expect(shape.type).toBe("rectangle");
    expect(sticky.type).toBe("rectangle");
    expect(getKind(shape)).toBe("shape");
    expect(getKind(sticky)).toBe("sticky");
  });

  it("★ شکل حاشیه دارد، استیکی ندارد", () => {
    const shape = createShape({ shape: "rectangle", x: 0, y: 0, ...deterministic() }).shape;
    const sticky = createSticky({ x: 0, y: 0, ...deterministic() }).container;

    expect(shape.strokeColor).not.toBe("transparent");
    expect(sticky.strokeColor).toBe("transparent");
  });

  it("★ پس‌زمینه‌ی شکل شفاف است، استیکی رنگی", () => {
    const shape = createShape({ shape: "rectangle", x: 0, y: 0, ...deterministic() }).shape;
    const sticky = createSticky({ x: 0, y: 0, ...deterministic() }).container;

    expect(shape.backgroundColor).toBe("transparent");
    expect(sticky.backgroundColor).not.toBe("transparent");
  });
});

describe("متن اختیاری داخل شکل", () => {
  it("بدون متن، فقط یک عنصر می‌سازد", () => {
    const result = createShape({ shape: "ellipse", x: 0, y: 0, ...deterministic() });
    expect(result.text).toBeNull();
    expect(result.elements).toHaveLength(1);
    expect(result.shape.boundElements).toBeNull();
  });

  it("با متن، دو عنصر مقید می‌سازد", () => {
    const result = createShape({
      shape: "rectangle",
      x: 0,
      y: 0,
      text: "سلام دنیا",
      ...deterministic(),
    });
    expect(result.text).not.toBeNull();
    expect(result.elements).toHaveLength(2);
    expect((result.text as HbTextElement).containerId).toBe(result.shape.id);
    expect(result.shape.boundElements).toEqual([{ id: result.text!.id, type: "text" }]);
  });

  it("رشته‌ی خالی متن نمی‌سازد", () => {
    expect(
      createShape({ shape: "rectangle", x: 0, y: 0, text: "", ...deterministic() }).text,
    ).toBeNull();
  });

  it("★ متن داخل شکل وسط‌چین است و رنگ متن دارد نه رنگ خط شکل", () => {
    const result = createShape({
      shape: "rectangle",
      x: 0,
      y: 0,
      text: "سلام",
      strokeColor: "#FF0000",
      ...deterministic(),
    });
    const text = result.text as HbTextElement;
    expect(text.textAlign).toBe("center");
    expect(text.verticalAlign).toBe("middle");
    expect(text.strokeColor).toBe(HB_UI_COLORS.text);
  });

  it("direction متن روی auto می‌ماند (ADR-024)", () => {
    const result = createShape({
      shape: "rectangle",
      x: 0,
      y: 0,
      text: "سلام دنیا",
      ...deterministic(),
    });
    expect((result.text as HbTextElement).direction).toBe("auto");
  });

  it("متن روی شکل قرار می‌گیرد (index بزرگ‌تر)", () => {
    const result = createShape({
      shape: "rectangle",
      x: 0,
      y: 0,
      text: "سلام",
      index: "a5",
      ...deterministic(),
    });
    expect(result.text!.index > result.shape.index).toBe(true);
  });
});

describe("قطعی بودن", () => {
  it("با ورودی یکسان خروجی یکسان می‌دهد", () => {
    const a = createShape({ shape: "diamond", x: 1, y: 2, text: "الف", ...deterministic() });
    const b = createShape({ shape: "diamond", x: 1, y: 2, text: "الف", ...deterministic() });
    expect(a.elements).toEqual(b.elements);
  });

  it("رنگ‌ها قابل override اند", () => {
    const shape = createShape({
      shape: "rectangle",
      x: 0,
      y: 0,
      strokeColor: "#123456",
      backgroundColor: "#ABCDEF",
      ...deterministic(),
    }).shape as HbElement;
    expect(shape.strokeColor).toBe("#123456");
    expect(shape.backgroundColor).toBe("#ABCDEF");
  });
});
