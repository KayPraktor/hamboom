import { describe, expect, it } from "vitest";

import {
  hbAppState,
  hbDrawElement,
  hbElement,
  hbFrameElement,
  hbImageElement,
  hbLinearElement,
  hbShapeElement,
  hbTextElement,
  type HbCustomData,
  type HbKind,
} from "./element.ts";

/** متادیتای مشترکی که هر عنصر لازم دارد. */
function customData(kind: HbKind, extra: Partial<HbCustomData["hb"]> = {}): HbCustomData {
  return {
    hb: {
      schema: 1,
      kind,
      createdBy: "u_1",
      lastEditedBy: "u_1",
      createdAt: 1_753_000_000_000,
      ...extra,
    },
  };
}

function base(kind: HbKind, extra: Partial<HbCustomData["hb"]> = {}) {
  return {
    id: "el_1",
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
    backgroundColor: "transparent",
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
    customData: customData(kind, extra),
  };
}

describe("هر هفت نوع عنصر ساخته و اعتبارسنجی می‌شوند", () => {
  it("استیکی‌نوت — ظرف مستطیلی با متن مقید", () => {
    const container = {
      ...base("sticky", { sticky: { palette: "yellow", autoFit: true } }),
      type: "rectangle" as const,
      strokeColor: "transparent",
      backgroundColor: "#FFF9B1",
      roundness: { type: 3 as const, value: 8 },
      boundElements: [{ id: "txt_1", type: "text" as const }],
    };
    expect(hbShapeElement.parse(container)).toBeTruthy();
    expect(hbElement.parse(container)).toBeTruthy();
  });

  it("شکل — بدون متن مقید", () => {
    const shape = { ...base("shape"), type: "ellipse" as const };
    expect(hbElement.parse(shape)).toBeTruthy();
  });

  it("متن آزاد — با جهت و راست‌چینی فارسی", () => {
    const text = {
      ...base("text"),
      type: "text" as const,
      containerId: null,
      text: "سلام دنیا",
      originalText: "سلام دنیا",
      fontSize: 20,
      fontFamily: 5,
      textAlign: "right" as const,
      verticalAlign: "top" as const,
      lineHeight: 1.6,
      direction: "auto" as const,
      autoResize: true,
    };
    expect(hbTextElement.parse(text)).toBeTruthy();
    expect(hbElement.parse(text)).toBeTruthy();
  });

  it("متن مقید — با containerId", () => {
    const bound = {
      ...base("text"),
      type: "text" as const,
      containerId: "stk_1",
      text: "سلام",
      originalText: "سلام",
      fontSize: 20,
      fontFamily: 5,
      textAlign: "center" as const,
      verticalAlign: "middle" as const,
      lineHeight: 1.6,
      direction: "rtl" as const,
      autoResize: true,
    };
    expect(hbTextElement.parse(bound).containerId).toBe("stk_1");
  });

  it("کانکتور — پیکان با اتصال دو سر", () => {
    const connector = {
      ...base("connector", { connector: { style: "elbow", label: "بله" } }),
      type: "arrow" as const,
      points: [
        [0, 0],
        [120, 40],
      ] as [number, number][],
      startBinding: { elementId: "stk_a", focus: 0.12, gap: 6 },
      endBinding: { elementId: "stk_b", focus: -0.3, gap: 6 },
      startArrowhead: null,
      endArrowhead: "arrow" as const,
      elbowed: true,
    };
    expect(hbLinearElement.parse(connector)).toBeTruthy();
    expect(hbElement.parse(connector)).toBeTruthy();
  });

  it("فریم — با نام فارسی", () => {
    const frame = {
      ...base("frame", { frame: { collapsed: false, color: "#5B8DEF" } }),
      type: "frame" as const,
      name: "جلسه هفتگی — هفته ۱۲",
    };
    expect(hbFrameElement.parse(frame).name).toContain("هفته");
  });

  it("تصویر — فقط ارجاع، بدون باینری", () => {
    const image = {
      ...base("image"),
      type: "image" as const,
      fileId: "f_9x8y7z",
      scale: [1, 1] as [number, number],
      status: "saved" as const,
      crop: null,
    };
    const parsed = hbImageElement.parse(image);
    expect(parsed.fileId).toBe("f_9x8y7z");
    // اگر روزی کسی باینری را اینجا گذاشت، این تست باید بشکند.
    expect(Object.keys(parsed)).not.toContain("data");
  });

  it("قلم آزاد", () => {
    const draw = {
      ...base("draw"),
      type: "freedraw" as const,
      points: [
        [0, 0],
        [2, 3],
      ] as [number, number][],
      pressures: [0.5, 0.6],
      simulatePressure: true,
    };
    expect(hbDrawElement.parse(draw)).toBeTruthy();
  });
});

describe("قواعدی که schema اعمال می‌کند", () => {
  it("★ استیکی و شکل هر دو rectangle اند و فقط با kind فرق دارند (ADR-010)", () => {
    const sticky = {
      ...base("sticky", { sticky: { palette: "pink", autoFit: true } }),
      type: "rectangle" as const,
    };
    const shape = { ...base("shape"), type: "rectangle" as const };

    expect(hbElement.parse(sticky).type).toBe("rectangle");
    expect(hbElement.parse(shape).type).toBe("rectangle");
    expect(hbElement.parse(sticky).customData.hb.kind).toBe("sticky");
    expect(hbElement.parse(shape).customData.hb.kind).toBe("shape");
  });

  it("index رشته است نه عدد — ایندکس کسری (ADR-007)", () => {
    const el = { ...base("shape"), type: "rectangle" as const, index: 3 };
    expect(() => hbElement.parse(el)).toThrow();
  });

  it("opacity خارج از بازه رد می‌شود", () => {
    const el = { ...base("shape"), type: "rectangle" as const, opacity: 150 };
    expect(() => hbElement.parse(el)).toThrow();
  });

  it("roughness فقط ۰، ۱ یا ۲", () => {
    const el = { ...base("shape"), type: "rectangle" as const, roughness: 3 };
    expect(() => hbElement.parse(el)).toThrow();
  });

  it("نوع ناشناخته رد می‌شود", () => {
    const el = { ...base("shape"), type: "hexagon" };
    expect(() => hbElement.parse(el)).toThrow();
  });

  it("customData اجباری است — عنصر بدون آن معتبر نیست", () => {
    const { customData: _omit, ...withoutCustomData } = base("shape");
    expect(() => hbElement.parse({ ...withoutCustomData, type: "rectangle" })).toThrow();
  });

  it("schema نسخه‌ی customData باید دقیقاً ۱ باشد", () => {
    const el = {
      ...base("shape"),
      type: "rectangle" as const,
      customData: { hb: { ...customData("shape").hb, schema: 2 } },
    };
    expect(() => hbElement.parse(el)).toThrow();
  });

  it("متن بدون direction رد می‌شود — ADR-024 آن را اجباری می‌کند", () => {
    const { ...text } = {
      ...base("text"),
      type: "text" as const,
      containerId: null,
      text: "سلام",
      originalText: "سلام",
      fontSize: 20,
      fontFamily: 5,
      textAlign: "right" as const,
      verticalAlign: "top" as const,
      lineHeight: 1.6,
      autoResize: true,
    };
    expect(() => hbTextElement.parse(text)).toThrow();
  });
});

describe("hbAppState", () => {
  it("وضعیت مشترک بورد اعتبارسنجی می‌شود", () => {
    const state = {
      viewBackgroundColor: "#ffffff",
      gridSize: 20,
      gridEnabled: false,
      snapToObjects: true,
      frameRendering: { enabled: true, name: true, outline: true, clip: true },
    };
    expect(hbAppState.parse(state)).toBeTruthy();
  });

  it("gridSize می‌تواند null باشد", () => {
    const state = {
      viewBackgroundColor: "#ffffff",
      gridSize: null,
      gridEnabled: false,
      snapToObjects: true,
      frameRendering: { enabled: true, name: true, outline: true, clip: true },
    };
    expect(hbAppState.parse(state).gridSize).toBeNull();
  });
});
