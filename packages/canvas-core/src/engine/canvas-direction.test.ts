import { afterEach, describe, expect, it } from "vitest";

import {
  installCanvasTextDirection,
  isCanvasTextDirectionInstalled,
  uninstallCanvasTextDirection,
} from "./canvas-direction";

/**
 * این تست‌ها **رندر واقعی را نمی‌آزمایند** — stub canvas در jsdom پیکسل تولید
 * نمی‌کند. آنچه اینجا اثبات می‌شود این است که wrapper در مسیر درست قرار
 * می‌گیرد و مقدار `direction` را از روی متن ست می‌کند.
 *
 * تایید خروجی بصری در مرورگر واقعی انجام شده — بخش ۶ و ۱۲ در
 * `docs/spike-persian-text.md`.
 */

afterEach(() => {
  uninstallCanvasTextDirection();
});

function makeContext() {
  return document.createElement("canvas").getContext("2d")!;
}

describe("installCanvasTextDirection", () => {
  it("قبل از نصب، هیچ جهتی ست نمی‌شود", () => {
    const ctx = makeContext();
    ctx.direction = "ltr";
    ctx.fillText("سلام دنیا", 0, 0);
    expect(ctx.direction).toBe("ltr");
  });

  it("بعد از نصب، جهت متن فارسی rtl می‌شود", () => {
    installCanvasTextDirection();
    const ctx = makeContext();
    ctx.direction = "ltr";
    ctx.fillText("سلام دنیا", 0, 0);
    expect(ctx.direction).toBe("rtl");
  });

  it("متن لاتین را ltr نگه می‌دارد", () => {
    installCanvasTextDirection();
    const ctx = makeContext();
    ctx.direction = "rtl";
    ctx.fillText("The quick brown fox", 0, 0);
    expect(ctx.direction).toBe("ltr");
  });

  it("★ رشته‌ای که با کلمه‌ی لاتین شروع می‌شود، rtl می‌گیرد (ADR-024)", () => {
    installCanvasTextDirection();
    const ctx = makeContext();
    ctx.direction = "ltr";
    ctx.fillText("board برای تیم ماست", 0, 0);
    expect(ctx.direction).toBe("rtl");
  });

  it("strokeText را هم پوشش می‌دهد", () => {
    installCanvasTextDirection();
    const ctx = makeContext();
    ctx.direction = "ltr";
    ctx.strokeText("سلام دنیا", 0, 0);
    expect(ctx.direction).toBe("rtl");
  });

  it("رشته‌ی خالی جهت را دست نمی‌زند", () => {
    installCanvasTextDirection();
    const ctx = makeContext();
    ctx.direction = "ltr";
    ctx.fillText("", 0, 0);
    expect(ctx.direction).toBe("ltr");
  });

  it("همه‌ی آرگومان‌ها به متد اصلی می‌رسند", () => {
    // متد اصلی را قبل از نصب wrapper ضبط می‌کنیم تا wrapper روی آن بنشیند.
    const calls: unknown[][] = [];
    const proto = CanvasRenderingContext2D.prototype as unknown as Record<string, unknown>;
    const real = proto.fillText;
    proto.fillText = function (...args: unknown[]) {
      calls.push(args);
    };

    installCanvasTextDirection();
    makeContext().fillText("سلام", 10, 20, 100);

    // ترتیب بازگردانی مهم است: اول wrapper، بعد جاسوس.
    uninstallCanvasTextDirection();
    proto.fillText = real;

    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual(["سلام", 10, 20, 100]);
  });

  it("نصب چندباره بی‌ضرر است و متد را چند لایه نمی‌کند", () => {
    installCanvasTextDirection();
    const afterFirst = CanvasRenderingContext2D.prototype.fillText;
    installCanvasTextDirection();
    installCanvasTextDirection();
    expect(CanvasRenderingContext2D.prototype.fillText).toBe(afterFirst);
    expect(isCanvasTextDirectionInstalled()).toBe(true);
  });

  it("uninstall متد اصلی را برمی‌گرداند", () => {
    const before = CanvasRenderingContext2D.prototype.fillText;
    installCanvasTextDirection();
    expect(CanvasRenderingContext2D.prototype.fillText).not.toBe(before);
    uninstallCanvasTextDirection();
    expect(CanvasRenderingContext2D.prototype.fillText).toBe(before);
    expect(isCanvasTextDirectionInstalled()).toBe(false);
  });

  it("کش، نتیجه‌ی یکسان می‌دهد و رفتار را عوض نمی‌کند", () => {
    installCanvasTextDirection();
    const ctx = makeContext();
    for (let i = 0; i < 100; i++) {
      ctx.direction = "ltr";
      ctx.fillText("board برای تیم ماست", 0, 0);
      expect(ctx.direction).toBe("rtl");
    }
  });
});
