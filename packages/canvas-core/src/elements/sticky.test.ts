import { hbElement, type HbElement, type HbTextElement } from "@hamboom/shared-types";
import { describe, expect, it } from "vitest";

import { getStickySwatch } from "../theme/sticky-palette";
import { HB_STICKY_GAP, HB_TYPO } from "../theme/tokens";
import { getKind } from "./mapping";
import {
  applyStickyPalette,
  createSticky,
  fitStickyFontSize,
  nextStickyPosition,
  stickyInnerBox,
  wrapTextGreedy,
} from "./sticky";

/** سازنده‌ی قطعی — بدون آن هر تست به Math.random وابسته می‌شد. */
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

/** اندازه‌گیر ساختگی و قطعی — هر کاراکتر نصف اندازه‌ی فونت عرض دارد. */
const fakeMeasure = (text: string, fontSize: number) => text.length * fontSize * 0.5;

describe("createSticky — ظرف و متن مقید", () => {
  it("دو عنصر می‌سازد: مستطیل و متن", () => {
    const { container, text } = createSticky({ x: 10, y: 20, ...deterministic() });
    expect(container.type).toBe("rectangle");
    expect(text.type).toBe("text");
  });

  it("★ از دید موتور مستطیل است، از دید محصول استیکی", () => {
    const { container } = createSticky({ x: 0, y: 0, ...deterministic() });
    expect(container.type).toBe("rectangle");
    expect(getKind(container)).toBe("sticky");
  });

  it("متن به ظرف مقید است و ظرف به متن ارجاع دارد", () => {
    const { container, text } = createSticky({ x: 0, y: 0, ...deterministic() });
    expect((text as HbTextElement).containerId).toBe(container.id);
    expect(container.boundElements).toEqual([{ id: text.id, type: "text" }]);
  });

  it("هر دو عنصر از schema رد می‌شوند", () => {
    const { elements } = createSticky({ x: 0, y: 0, text: "سلام", ...deterministic() });
    for (const element of elements) expect(() => hbElement.parse(element)).not.toThrow();
  });

  it("★ حاشیه ندارد — تفاوت اصلی با یک مستطیل رنگی", () => {
    const { container } = createSticky({ x: 0, y: 0, ...deterministic() });
    expect(container.strokeColor).toBe("transparent");
  });

  it("رنگ پس‌زمینه و متن از پالت می‌آید", () => {
    const { container, text } = createSticky({ x: 0, y: 0, palette: "pink", ...deterministic() });
    const swatch = getStickySwatch("pink");
    expect(container.backgroundColor).toBe(swatch.bg);
    expect(text.strokeColor).toBe(swatch.text);
  });

  it("رنگ پیش‌فرض زرد است", () => {
    const { container } = createSticky({ x: 0, y: 0, ...deterministic() });
    expect(container.backgroundColor).toBe(getStickySwatch("yellow").bg);
  });

  it("roughness صفر است — استایل تمیز", () => {
    const { container } = createSticky({ x: 0, y: 0, ...deterministic() });
    expect(container.roughness).toBe(0);
  });

  it("★ متن مقید وسط‌چین است و direction روی auto می‌ماند", () => {
    const { text } = createSticky({ x: 0, y: 0, text: "سلام دنیا", ...deterministic() });
    const t = text as HbTextElement;
    expect(t.textAlign).toBe("center");
    expect(t.verticalAlign).toBe("middle");
    // مقدار صریح فقط وقتی ست می‌شود که کاربر خودش انتخاب کند (ADR-024).
    expect(t.direction).toBe("auto");
  });

  it("متن روی ظرف قرار می‌گیرد (index بزرگ‌تر)", () => {
    const { container, text } = createSticky({ x: 0, y: 0, index: "a5", ...deterministic() });
    expect(text.index > container.index).toBe(true);
  });

  it("★ با measure، اندازه‌ی فونت از طول متن حساب می‌شود", () => {
    const short = createSticky({
      x: 0,
      y: 0,
      text: "سلام",
      measure: fakeMeasure,
      ...deterministic(),
    });
    const long = createSticky({
      x: 0,
      y: 0,
      text: "هم‌بوم یک بوم همکاری آنلاین است که تیم‌ها می‌توانند روی آن با هم فکر کنند و ایده بسازند",
      measure: fakeMeasure,
      ...deterministic(),
    });
    expect((long.text as HbTextElement).fontSize).toBeLessThan(
      (short.text as HbTextElement).fontSize,
    );
  });

  it("بدون measure اندازه‌ی پیش‌فرض می‌ماند — تابع خالص باقی می‌ماند", () => {
    const sticky = createSticky({ x: 0, y: 0, text: "ا".repeat(500), ...deterministic() });
    expect((sticky.text as HbTextElement).fontSize).toBe(HB_TYPO.defaultFontSize);
  });

  it("با ورودی یکسان خروجی یکسان می‌دهد", () => {
    const a = createSticky({ x: 1, y: 2, text: "الف", ...deterministic() });
    const b = createSticky({ x: 1, y: 2, text: "الف", ...deterministic() });
    expect(a.elements).toEqual(b.elements);
  });
});

describe("wrapTextGreedy", () => {
  it("روی مرز کلمه می‌شکند", () => {
    const lines = wrapTextGreedy("یک دو سه چهار", 60, 20, fakeMeasure);
    expect(lines.every((l) => !l.startsWith(" ") && !l.endsWith(" "))).toBe(true);
    expect(lines.join(" ")).toBe("یک دو سه چهار");
  });

  it("خط جدید صریح را حفظ می‌کند", () => {
    const lines = wrapTextGreedy("الف\nب", 1000, 20, fakeMeasure);
    expect(lines).toEqual(["الف", "ب"]);
  });

  it("★ کلمه‌ی پهن‌تر از ظرف را اجباری می‌شکند", () => {
    // محدودیت شناخته‌شده‌ی spike گام ۱٫۳: در فارسی اتصال حروف پاره می‌شود.
    const lines = wrapTextGreedy("سسسسسسسسسس", 30, 20, fakeMeasure);
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.join("")).toBe("سسسسسسسسسس");
  });

  it("متن خالی یک خط خالی می‌دهد", () => {
    expect(wrapTextGreedy("", 100, 20, fakeMeasure)).toEqual([""]);
  });
});

describe("fitStickyFontSize — رفتار میرو", () => {
  const { innerWidth, innerHeight } = stickyInnerBox();

  it("متن کوتاه بزرگ‌ترین اندازه را می‌گیرد", () => {
    const size = fitStickyFontSize({
      text: "سلام",
      innerWidth,
      innerHeight,
      measure: fakeMeasure,
    });
    expect(size).toBe(Math.max(...HB_TYPO.fontSizes));
  });

  it("★ متن بلندتر اندازه‌ی کوچک‌تری می‌گیرد", () => {
    const short = fitStickyFontSize({
      text: "سلام",
      innerWidth,
      innerHeight,
      measure: fakeMeasure,
    });
    const long = fitStickyFontSize({
      text: "هم‌بوم یک بوم همکاری آنلاین است که تیم‌ها می‌توانند روی آن با هم فکر کنند و ایده بسازند",
      innerWidth,
      innerHeight,
      measure: fakeMeasure,
    });
    expect(long).toBeLessThan(short);
  });

  it("هرچه متن بلندتر، اندازه یکنواخت کوچک‌تر یا مساوی", () => {
    let previous = Number.POSITIVE_INFINITY;
    for (const length of [4, 20, 60, 140, 400]) {
      const size = fitStickyFontSize({
        text: "ا".repeat(length),
        innerWidth,
        innerHeight,
        measure: fakeMeasure,
      });
      expect(size).toBeLessThanOrEqual(previous);
      previous = size;
    }
  });

  it("هرگز از بازه‌ی مجاز خارج نمی‌شود", () => {
    for (const length of [1, 50, 5000]) {
      const size = fitStickyFontSize({
        text: "ا".repeat(length),
        innerWidth,
        innerHeight,
        measure: fakeMeasure,
      });
      expect(size).toBeGreaterThanOrEqual(HB_TYPO.stickyFontRange.min);
      expect(size).toBeLessThanOrEqual(HB_TYPO.stickyFontRange.max);
    }
  });

  it("★ متنی که در هیچ اندازه‌ای جا نمی‌شود، کوچک‌ترین را می‌گیرد نه خطا", () => {
    // استیکی سرریز می‌کند ولی خالی نمی‌ماند — حالت خطا برای یک استیکی زیادی است.
    const size = fitStickyFontSize({
      text: "ا".repeat(100_000),
      innerWidth,
      innerHeight,
      measure: fakeMeasure,
    });
    expect(size).toBe(Math.min(...HB_TYPO.fontSizes));
  });

  it("متن خالی بزرگ‌ترین اندازه را می‌گیرد", () => {
    expect(fitStickyFontSize({ text: "   ", innerWidth, innerHeight, measure: fakeMeasure })).toBe(
      Math.max(...HB_TYPO.fontSizes),
    );
  });
});

describe("applyStickyPalette", () => {
  function makeSelection(): HbElement[] {
    const a = createSticky({ x: 0, y: 0, palette: "yellow", ...deterministic() });
    const b = createSticky({ x: 300, y: 0, palette: "yellow", ...deterministic() });
    return [...a.elements, ...b.elements];
  }

  it("رنگ همه‌ی استیکی‌های انتخاب را عوض می‌کند", () => {
    const next = applyStickyPalette(makeSelection(), "blue");
    const swatch = getStickySwatch("blue");
    for (const el of next.filter((e) => getKind(e) === "sticky")) {
      expect(el.backgroundColor).toBe(swatch.bg);
    }
  });

  it("★ رنگ متن مقید را هم عوض می‌کند", () => {
    // وگرنه متن روی پس‌زمینه‌ی جدید ناخوانا می‌شود — همان چیزی که
    // گیت کنتراست گام ۳٫۱ جلویش را می‌گیرد.
    const next = applyStickyPalette(makeSelection(), "black");
    const swatch = getStickySwatch("black");
    const texts = next.filter((e) => e.type === "text");
    expect(texts).toHaveLength(2);
    for (const text of texts) expect(text.strokeColor).toBe(swatch.text);
  });

  it("کلید پالت در customData ثبت می‌شود", () => {
    const next = applyStickyPalette(makeSelection(), "mint");
    const sticky = next.find((e) => getKind(e) === "sticky")!;
    expect(sticky.customData.hb.sticky?.palette).toBe("mint");
  });

  it("★ عناصر غیر استیکی دست‌نخورده رد می‌شوند", () => {
    const sticky = createSticky({ x: 0, y: 0, ...deterministic() });
    const shape = {
      ...sticky.container,
      id: "shp_1",
      customData: { hb: { ...sticky.container.customData.hb, kind: "shape" as const } },
    } as HbElement;

    const next = applyStickyPalette([...sticky.elements, shape], "red");
    expect(next.find((e) => e.id === "shp_1")).toBe(shape);
  });

  it("انتخاب بدون استیکی، همان آرایه را برمی‌گرداند", () => {
    const shape = {
      ...createSticky({ x: 0, y: 0, ...deterministic() }).container,
      customData: {
        hb: {
          schema: 1 as const,
          kind: "shape" as const,
          createdBy: "u",
          lastEditedBy: "u",
          createdAt: 0,
        },
      },
    } as HbElement;
    const input = [shape];
    expect(applyStickyPalette(input, "red")).toBe(input);
  });

  it("version را جلو می‌برد تا موتور تغییر را ببیند", () => {
    const before = makeSelection();
    const after = applyStickyPalette(before, "green");
    expect(after[0]!.version).toBe(before[0]!.version + 1);
  });
});

describe("nextStickyPosition — چیدمان Tab", () => {
  const previous = { x: 100, y: 100, width: 220, height: 220 };

  it("★ در RTL به سمت چپ می‌رود", () => {
    // چیدمان جهت خواندن را دنبال می‌کند (ADR-016) — برخلاف مختصات بوم
    // که هرگز آینه نمی‌شود.
    const next = nextStickyPosition(previous, "inline", "rtl");
    expect(next.x).toBe(100 - 220 - HB_STICKY_GAP);
    expect(next.y).toBe(100);
  });

  it("در LTR به سمت راست می‌رود", () => {
    expect(nextStickyPosition(previous, "inline", "ltr").x).toBe(100 + 220 + HB_STICKY_GAP);
  });

  it("جهت عمودی مستقل از زبان است", () => {
    for (const dir of ["rtl", "ltr"] as const) {
      const next = nextStickyPosition(previous, "block", dir);
      expect(next).toEqual({ x: 100, y: 100 + 220 + HB_STICKY_GAP });
    }
  });

  it("فاصله‌ها یکنواخت‌اند — پنج استیکی پشت‌سرهم", () => {
    let position = { ...previous };
    const xs = [position.x];
    for (let i = 0; i < 4; i++) {
      position = { ...position, ...nextStickyPosition(position, "inline", "rtl") };
      xs.push(position.x);
    }
    const gaps = xs.slice(1).map((x, i) => xs[i]! - x);
    expect(new Set(gaps).size).toBe(1);
  });
});
