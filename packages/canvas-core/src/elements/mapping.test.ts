import { hbElement, type HbElement, type HbKind } from "@hamboom/shared-types";
import { describe, expect, it } from "vitest";

import { fromExcalidraw, getDirection, getKind, isSticky, toExcalidraw } from "./mapping";

/** پایه‌ی مشترک — همان شکلی که `shared-types` اعتبارسنجی می‌کند. */
function base(kind: HbKind, id = "el_1") {
  return {
    id,
    x: 100,
    y: 200,
    width: 220,
    height: 220,
    angle: 0,
    index: "a3",
    frameId: null,
    groupIds: [],
    locked: false,
    strokeColor: "#1a1a1a",
    backgroundColor: "#FFF9B1",
    fillStyle: "solid" as const,
    strokeWidth: 1,
    strokeStyle: "solid" as const,
    roughness: 0 as const,
    opacity: 100,
    roundness: null,
    seed: 12345,
    version: 1,
    versionNonce: 987654,
    updated: 1_753_000_000_000,
    isDeleted: false,
    boundElements: null,
    link: null,
    customData: {
      hb: {
        schema: 1 as const,
        kind,
        createdBy: "u_1",
        lastEditedBy: "u_1",
        createdAt: 1_753_000_000_000,
      },
    },
  };
}

/** یک نمونه از هر هفت نوع محصولی. */
const SAMPLES: Record<string, HbElement> = {
  sticky: {
    ...base("sticky", "stk_1"),
    type: "rectangle",
    strokeColor: "transparent",
    roundness: { type: 3, value: 8 },
    boundElements: [{ id: "txt_1", type: "text" }],
    customData: {
      hb: { ...base("sticky").customData.hb, sticky: { palette: "yellow", autoFit: true } },
    },
  } as HbElement,

  shape: { ...base("shape", "shp_1"), type: "ellipse" } as HbElement,

  text: {
    ...base("text", "txt_1"),
    type: "text",
    containerId: null,
    text: "سلام دنیا",
    originalText: "سلام دنیا",
    fontSize: 20,
    fontFamily: 5,
    textAlign: "right",
    verticalAlign: "top",
    lineHeight: 1.6,
    direction: "auto",
    autoResize: true,
  } as HbElement,

  connector: {
    ...base("connector", "arw_1"),
    type: "arrow",
    points: [
      [0, 0],
      [120, 40],
    ],
    startBinding: { elementId: "stk_1", focus: 0.12, gap: 6 },
    endBinding: null,
    startArrowhead: null,
    endArrowhead: "arrow",
    elbowed: true,
    customData: {
      hb: { ...base("connector").customData.hb, connector: { style: "elbow" as const } },
    },
  } as HbElement,

  frame: {
    ...base("frame", "frm_1"),
    type: "frame",
    name: "جلسه هفتگی",
    customData: {
      hb: { ...base("frame").customData.hb, frame: { collapsed: false, color: "#5B8DEF" } },
    },
  } as HbElement,

  image: {
    ...base("image", "img_1"),
    type: "image",
    fileId: "f_9x8y7z",
    scale: [1, 1],
    status: "saved",
    crop: null,
  } as HbElement,

  draw: {
    ...base("draw", "drw_1"),
    type: "freedraw",
    points: [
      [0, 0],
      [2, 3],
    ],
    pressures: [0.5, 0.6],
    simulatePressure: true,
  } as HbElement,
};

describe("round-trip — هر هفت نوع بدون تلفات برمی‌گردند", () => {
  for (const [name, sample] of Object.entries(SAMPLES)) {
    it(`${name}`, () => {
      const back = fromExcalidraw(toExcalidraw(sample));
      expect(back).toEqual(sample);
    });
  }

  it("خروجی round-trip همچنان از schema رد می‌شود", () => {
    for (const sample of Object.values(SAMPLES)) {
      expect(() => hbElement.parse(fromExcalidraw(toExcalidraw(sample)))).not.toThrow();
    }
  });

  it("دوبار round-trip همان نتیجه‌ی یک‌بار را می‌دهد", () => {
    for (const sample of Object.values(SAMPLES)) {
      const once = fromExcalidraw(toExcalidraw(sample));
      const twice = fromExcalidraw(toExcalidraw(once));
      expect(twice).toEqual(once);
    }
  });
});

describe("getKind — تنها راه مجاز خواندن نوع محصولی (ADR-010)", () => {
  it("★ استیکی و شکل هر دو rectangle اند ولی kind متفاوتی دارند", () => {
    const sticky = SAMPLES.sticky!;
    const shape = { ...SAMPLES.shape!, type: "rectangle" } as HbElement;

    expect(sticky.type).toBe("rectangle");
    expect(shape.type).toBe("rectangle");
    expect(getKind(sticky)).toBe("sticky");
    expect(getKind(shape)).toBe("shape");
    expect(isSticky(sticky)).toBe(true);
    expect(isSticky(shape)).toBe(false);
  });

  it("★ عنصری که نوار ابزار خودِ موتور ساخته (بدون customData) هم kind می‌گیرد", () => {
    // بدون این fallback، هر شکلی که کاربر با ابزار پیش‌فرض بکشد بی‌kind می‌ماند.
    expect(getKind({ type: "rectangle" })).toBe("shape");
    expect(getKind({ type: "arrow" })).toBe("connector");
    expect(getKind({ type: "text" })).toBe("text");
    expect(getKind({ type: "freedraw" })).toBe("draw");
    expect(getKind({ type: "image" })).toBe("image");
    expect(getKind({ type: "frame" })).toBe("frame");
    expect(getKind({ type: "line" })).toBe("shape");
  });

  it("نوع ناشناخته به shape برمی‌گردد، نه undefined", () => {
    expect(getKind({ type: "hexagon" })).toBe("shape");
  });

  it("customData بر استنتاج از type مقدم است", () => {
    const el = { type: "rectangle", customData: { hb: { kind: "sticky" as const } } };
    expect(getKind(el)).toBe("sticky");
  });
});

describe("جهت متن در عبور از موتور زنده می‌ماند", () => {
  it("★ direction به customData منتقل می‌شود تا از serialization جان سالم به در ببرد", () => {
    const engine = toExcalidraw(SAMPLES.text!);
    const hb = (engine.customData as { hb: { direction?: string } }).hb;
    expect(hb.direction).toBe("auto");
  });

  it("در مسیر برگشت به سطح بالا برمی‌گردد", () => {
    const back = fromExcalidraw(toExcalidraw(SAMPLES.text!));
    expect((back as { direction?: string }).direction).toBe("auto");
  });

  it("★ اگر موتور فیلد سطح بالا را انداخته باشد، از customData بازیابی می‌شود", () => {
    const engine = toExcalidraw(SAMPLES.text!);
    // شبیه‌سازی: موتور فیلدهای ناشناخته‌ی سطح بالا را دور انداخته.
    delete (engine as Record<string, unknown>).direction;

    const back = fromExcalidraw(engine);
    expect((back as { direction?: string }).direction).toBe("auto");
  });

  it("مقدار صریح rtl حفظ می‌شود", () => {
    const rtlText = { ...SAMPLES.text!, direction: "rtl" } as HbElement;
    const back = fromExcalidraw(toExcalidraw(rtlText));
    expect((back as { direction?: string }).direction).toBe("rtl");
  });

  it("روی عناصر غیرمتنی اصلاً اضافه نمی‌شود", () => {
    const back = fromExcalidraw(toExcalidraw(SAMPLES.shape!));
    expect(back).not.toHaveProperty("direction");
  });

  it("متنی که موتور ساخته و direction ندارد، auto می‌گیرد", () => {
    const back = fromExcalidraw({ type: "text", text: "سلام" });
    expect(getDirection(back)).toBe("auto");
  });
});
