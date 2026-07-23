import { hbElement, type HbTextElement } from "@hamboom/shared-types";
import { describe, expect, it } from "vitest";

import { HB_TYPO } from "../theme/tokens";
import { getKind } from "./mapping";
import { createText, realignTextForContent } from "./text";

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

const asText = (element: unknown) => element as HbTextElement;

describe("createText — متن آزاد", () => {
  it("از schema رد می‌شود", () => {
    const element = createText({ x: 0, y: 0, text: "سلام", ...deterministic() });
    expect(() => hbElement.parse(element)).not.toThrow();
  });

  it("kind محصولی text است", () => {
    expect(getKind(createText({ x: 0, y: 0, ...deterministic() }))).toBe("text");
  });

  it("★ متن آزاد است، نه مقید", () => {
    const element = asText(createText({ x: 0, y: 0, ...deterministic() }));
    expect(element.containerId).toBeNull();
    // برخلاف متن استیکی، خودش با محتوا بزرگ می‌شود.
    expect(element.autoResize).toBe(true);
  });

  it("★ متن فارسی راست‌چین می‌شود", () => {
    const element = asText(createText({ x: 0, y: 0, text: "سلام دنیا", ...deterministic() }));
    expect(element.textAlign).toBe("right");
  });

  it("★ متن لاتین چپ‌چین می‌شود", () => {
    const element = asText(
      createText({ x: 0, y: 0, text: "The quick brown fox", ...deterministic() }),
    );
    expect(element.textAlign).toBe("left");
  });

  it("★ رشته‌ای که با کلمه‌ی لاتین شروع می‌شود، راست‌چین می‌ماند (ADR-024)", () => {
    // همان موردی که الگوریتم استاندارد dir=auto اشتباه می‌کند.
    const element = asText(
      createText({ x: 0, y: 0, text: "board برای تیم ماست", ...deterministic() }),
    );
    expect(element.textAlign).toBe("right");
  });

  it("متن خالی راست‌چین می‌ماند — پیش‌فرض فارسی", () => {
    expect(asText(createText({ x: 0, y: 0, ...deterministic() })).textAlign).toBe("right");
  });

  it("direction روی auto می‌ماند مگر صریح داده شود", () => {
    expect(asText(createText({ x: 0, y: 0, text: "سلام", ...deterministic() })).direction).toBe(
      "auto",
    );
    const explicit = asText(
      createText({ x: 0, y: 0, text: "سلام", direction: "ltr", ...deterministic() }),
    );
    expect(explicit.direction).toBe("ltr");
  });

  it("★ جهت صریح بر محتوا مقدم است", () => {
    // متن فارسی ولی کاربر صریحاً چپ‌چین خواسته.
    const element = asText(
      createText({ x: 0, y: 0, text: "سلام دنیا", direction: "ltr", ...deterministic() }),
    );
    expect(element.textAlign).toBe("left");
  });

  it("lineHeight فارسی ۱٫۶ است", () => {
    expect(asText(createText({ x: 0, y: 0, ...deterministic() })).lineHeight).toBe(
      HB_TYPO.lineHeight,
    );
  });

  it("اندازه‌ی فونت قابل تنظیم است", () => {
    expect(asText(createText({ x: 0, y: 0, fontSize: 36, ...deterministic() })).fontSize).toBe(36);
  });

  it("با ورودی یکسان خروجی یکسان می‌دهد", () => {
    const a = createText({ x: 1, y: 2, text: "الف", ...deterministic() });
    const b = createText({ x: 1, y: 2, text: "الف", ...deterministic() });
    expect(a).toEqual(b);
  });
});

describe("realignTextForContent — وقتی کاربر متن را عوض می‌کند", () => {
  it("★ فارسی → لاتین، راست‌چین به چپ‌چین می‌رود", () => {
    const persian = createText({ x: 0, y: 0, text: "سلام دنیا", ...deterministic() });
    expect(asText(persian).textAlign).toBe("right");

    const edited = { ...persian, text: "The quick brown fox" } as typeof persian;
    expect(asText(realignTextForContent(edited)).textAlign).toBe("left");
  });

  it("لاتین → فارسی، چپ‌چین به راست‌چین می‌رود", () => {
    const latin = createText({ x: 0, y: 0, text: "hello world", ...deterministic() });
    const edited = { ...latin, text: "سلام دنیا" } as typeof latin;
    expect(asText(realignTextForContent(edited)).textAlign).toBe("right");
  });

  it("★ جهت صریح دست‌نخورده می‌ماند — انتخاب کاربر بر heuristic مقدم است", () => {
    const explicit = createText({
      x: 0,
      y: 0,
      text: "سلام دنیا",
      direction: "ltr",
      ...deterministic(),
    });
    const edited = { ...explicit, text: "همه‌اش فارسی شد" } as typeof explicit;
    const result = realignTextForContent(edited);
    expect(asText(result).textAlign).toBe("left");
    expect(result).toBe(edited);
  });

  it("اگر چیزی عوض نشود همان مرجع را برمی‌گرداند", () => {
    const element = createText({ x: 0, y: 0, text: "سلام دنیا", ...deterministic() });
    expect(realignTextForContent(element)).toBe(element);
  });

  it("version فقط وقتی عوض می‌شود که واقعاً تغییری باشد", () => {
    const persian = createText({ x: 0, y: 0, text: "سلام", ...deterministic() });
    const edited = { ...persian, text: "hello" } as typeof persian;
    expect(realignTextForContent(edited).version).toBe(persian.version + 1);
  });

  it("عنصر غیرمتنی را دست نمی‌زند", () => {
    const notText = { ...createText({ x: 0, y: 0, ...deterministic() }), type: "rectangle" };
    expect(realignTextForContent(notText as never)).toBe(notText);
  });
});
