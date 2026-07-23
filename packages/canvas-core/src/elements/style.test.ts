import type { HbElement, HbTextElement } from "@hamboom/shared-types";
import { describe, expect, it } from "vitest";

import { HB_TYPO } from "../theme/tokens";
import { createShape } from "./shape";
import { applyStyle, commonStyle, withBoundElements } from "./style";
import { createText } from "./text";

/**
 * ⚠️ شمارنده عمداً بین دو فراخوانی **ریست نمی‌شود** — وگرنه دو عنصر یک `id`
 * می‌گیرند و هر تستی که روی «فقط این یکی را عوض کن» تکیه دارد، بی‌دلیل
 * شکست می‌خورد یا بدتر، بی‌دلیل پاس می‌شود.
 */
let counter = 0;
function deterministic() {
  return {
    authorId: "u_1",
    now: 1_753_000_000_000,
    makeId: () => `id${++counter}`,
    random: () => 0.5,
  };
}

function scene(): HbElement[] {
  const a = createShape({ shape: "rectangle", x: 0, y: 0, ...deterministic() });
  const b = createShape({ shape: "ellipse", x: 300, y: 0, ...deterministic() });
  const elements = [...a.elements, ...b.elements];
  // اگر روزی این ناوردا بشکند، تست‌های زیر بی‌معنی می‌شوند.
  if (new Set(elements.map((e) => e.id)).size !== elements.length) {
    throw new Error("شناسه‌های تکراری در scene — helper تست خراب است");
  }
  return elements;
}

const ids = (elements: HbElement[]) => new Set(elements.map((e) => e.id));

describe("applyStyle", () => {
  it("خصوصیت را روی انتخاب اعمال می‌کند", () => {
    const elements = scene();
    const next = applyStyle(elements, ids(elements), { strokeColor: "#FF0000" });
    for (const element of next) expect(element.strokeColor).toBe("#FF0000");
  });

  it("عناصر خارج از انتخاب را دست نمی‌زند", () => {
    const elements = scene();
    const next = applyStyle(elements, new Set([elements[0]!.id]), { opacity: 50 });
    expect(next[0]!.opacity).toBe(50);
    expect(next[1]!.opacity).toBe(100);
  });

  it("★ اگر چیزی عوض نشود همان مرجع را برمی‌گرداند", () => {
    // جلوی رندر بی‌دلیل را می‌گیرد.
    const elements = scene();
    expect(applyStyle(elements, new Set(), { opacity: 50 })).toBe(elements);
    expect(applyStyle(elements, ids(elements), {})).toBe(elements);
  });

  it("version را جلو می‌برد تا موتور تغییر را ببیند", () => {
    const elements = scene();
    const next = applyStyle(elements, ids(elements), { strokeWidth: 4 });
    expect(next[0]!.version).toBe(elements[0]!.version + 1);
  });

  it("چند خصوصیت را با هم اعمال می‌کند", () => {
    const elements = scene();
    const next = applyStyle(elements, ids(elements), {
      strokeColor: "#111111",
      backgroundColor: "#EEEEEE",
      strokeWidth: 2,
      strokeStyle: "dashed",
      opacity: 80,
    });
    expect(next[0]).toMatchObject({
      strokeColor: "#111111",
      backgroundColor: "#EEEEEE",
      strokeWidth: 2,
      strokeStyle: "dashed",
      opacity: 80,
    });
  });
});

describe("★ fontSize فقط روی متن، و کلمپ‌شده", () => {
  it("روی عنصر غیرمتنی اعمال نمی‌شود", () => {
    // یک مستطیل با fontSize از schema می‌افتد.
    const elements = scene();
    const next = applyStyle(elements, ids(elements), { fontSize: 28 });
    expect(next[0]).not.toHaveProperty("fontSize");
  });

  it("روی متن اعمال می‌شود", () => {
    const text = createText({ x: 0, y: 0, text: "سلام", ...deterministic() });
    const next = applyStyle([text], new Set([text.id]), { fontSize: 28 });
    expect((next[0] as HbTextElement).fontSize).toBe(28);
  });

  it("★ مقدار خارج از بازه کلمپ می‌شود، نه رد", () => {
    // یک اسلایدر می‌تواند ۰ یا ۹۹۹ بفرستد؛ متنی با آن اندازه رندر نمی‌شود.
    const text = createText({ x: 0, y: 0, text: "سلام", ...deterministic() });

    const tooSmall = applyStyle([text], new Set([text.id]), { fontSize: 2 });
    expect((tooSmall[0] as HbTextElement).fontSize).toBe(HB_TYPO.stickyFontRange.min);

    const tooBig = applyStyle([text], new Set([text.id]), { fontSize: 999 });
    expect((tooBig[0] as HbTextElement).fontSize).toBe(HB_TYPO.stickyFontRange.max);
  });

  it("انتخاب مخلوط: متن اندازه می‌گیرد، شکل نه", () => {
    const shape = createShape({ shape: "rectangle", x: 0, y: 0, ...deterministic() }).shape;
    const text = createText({ x: 0, y: 0, text: "سلام", ...deterministic() });
    const next = applyStyle([shape, text], new Set([shape.id, text.id]), { fontSize: 28 });

    expect(next[0]).not.toHaveProperty("fontSize");
    expect((next[1] as HbTextElement).fontSize).toBe(28);
  });
});

describe("commonStyle — مقادیر مختلط", () => {
  it("وقتی همه یکسان‌اند مقدار را می‌دهد", () => {
    const elements = scene();
    expect(commonStyle(elements, ids(elements)).opacity).toBe(100);
  });

  it("★ وقتی مقادیر مختلف‌اند undefined می‌دهد، نه مقدار اولی", () => {
    // اگر مقدار اولی را جا بزند، اولین کلیک روی پنل بقیه را هم به آن می‌برد.
    const elements = scene();
    const mixed = applyStyle(elements, new Set([elements[0]!.id]), { opacity: 40 });
    expect(commonStyle(mixed, ids(mixed)).opacity).toBeUndefined();
  });

  it("انتخاب خالی چیزی نمی‌دهد", () => {
    expect(commonStyle(scene(), new Set())).toEqual({});
  });

  it("fontSize فقط وقتی می‌آید که متنی در انتخاب باشد", () => {
    const elements = scene();
    expect(commonStyle(elements, ids(elements)).fontSize).toBeUndefined();

    const text = createText({ x: 0, y: 0, text: "سلام", ...deterministic() });
    expect(commonStyle([text], new Set([text.id])).fontSize).toBe(HB_TYPO.defaultFontSize);
  });
});

describe("★ withBoundElements", () => {
  it("متن مقید را به انتخاب اضافه می‌کند", () => {
    // کاربر ظرف را انتخاب می‌کند، ولی از دید او ظرف و متنش یک چیزند.
    const result = createShape({
      shape: "rectangle",
      x: 0,
      y: 0,
      text: "سلام",
      ...deterministic(),
    });
    const expanded = withBoundElements(result.elements, new Set([result.shape.id]));
    expect(expanded.has(result.text!.id)).toBe(true);
    expect(expanded.size).toBe(2);
  });

  it("عنصر بدون متن مقید را عوض نمی‌کند", () => {
    const shape = createShape({ shape: "ellipse", x: 0, y: 0, ...deterministic() }).shape;
    expect(withBoundElements([shape], new Set([shape.id])).size).toBe(1);
  });

  it("با applyStyle ترکیب می‌شود تا شکل و متنش با هم عوض شوند", () => {
    const result = createShape({
      shape: "rectangle",
      x: 0,
      y: 0,
      text: "سلام",
      ...deterministic(),
    });
    const selection = withBoundElements(result.elements, new Set([result.shape.id]));
    const next = applyStyle(result.elements, selection, { opacity: 60 });
    expect(next.every((element) => element.opacity === 60)).toBe(true);
  });
});
