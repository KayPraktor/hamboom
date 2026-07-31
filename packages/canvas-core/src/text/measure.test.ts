import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { clearMeasureCache, createFontString, measureCacheSize, measureLineWidth } from "./measure";

/**
 * تستِ لایه‌ی اندازه‌گیریِ متن — گام ۶٫۱.
 *
 * jsdom بدون پکیجِ `canvas` یک context واقعی نمی‌دهد، پس `getContext` را با یک
 * context ساختگیِ **قطعی** جایگزین می‌کنیم (عرض = طولِ رشته × ۱۰). همین برای
 * آزمودنِ منطقِ کش، مرزِ ظرفیت، و مسیرِ «بدونِ canvas» کافی است — چیزی که واقعاً
 * اینجا منطق دارد. عرضِ واقعیِ گلیف کارِ خودِ مرورگر است، نه این فایل.
 */

// همان شیءِ context در همه‌ی فراخوانی‌ها برگردانده می‌شود، چون `measure.ts` اولین
// context را memoize می‌کند؛ اگر هر بار شیءِ نو بدهیم، شمارشِ measureText با نمونه‌ی
// memoize‌شده جور درنمی‌آید.
const fakeMeasureText = vi.fn((text: string) => ({ width: text.length * 10 }));
const fakeCtx = { font: "", measureText: fakeMeasureText } as unknown as CanvasRenderingContext2D;

describe("createFontString", () => {
  it("رشته‌ی فونتِ قابل‌فهم برای canvas می‌سازد", () => {
    expect(createFontString(16, "Vazirmatn")).toBe("16px Vazirmatn");
    expect(createFontString(48, "Arial, sans-serif")).toBe("48px Arial, sans-serif");
  });
});

describe("measureLineWidth — بدونِ context (تستِ node)", () => {
  // ★ این بلاک باید قبل از بلاکِ «با context» بماند: به‌محضِ اینکه یک context معتبر
  //   memoize شود، `getContext` دیگر صدا زده نمی‌شود و null‌کردنش بی‌اثر می‌ماند.
  afterEach(() => {
    vi.restoreAllMocks();
    clearMeasureCache();
  });

  it("رشته‌ی خالی همیشه ۰ است (بدونِ نیاز به canvas)", () => {
    expect(measureLineWidth("", "16px Vazirmatn")).toBe(0);
  });

  it("اگر canvas نباشد NaN می‌دهد — نه صفرِ خاموش", () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
      null as unknown as ReturnType<HTMLCanvasElement["getContext"]>,
    );
    expect(Number.isNaN(measureLineWidth("سلام", "16px Vazirmatn"))).toBe(true);
    // چون context نداشت، چیزی کش نشد.
    expect(measureCacheSize()).toBe(0);
  });
});

describe("measureLineWidth — با contextِ ساختگی", () => {
  beforeEach(() => {
    clearMeasureCache();
    fakeMeasureText.mockClear();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
      fakeCtx as unknown as ReturnType<HTMLCanvasElement["getContext"]>,
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("عرضِ خط را از context می‌گیرد و فونت را ست می‌کند", () => {
    const font = "16px Vazirmatn";
    expect(measureLineWidth("abc", font)).toBe(30);
    expect(fakeCtx.font).toBe(font);
  });

  it("بارِ دوم از کش می‌خواند — measureText دوباره صدا زده نمی‌شود", () => {
    const font = "16px Vazirmatn";
    measureLineWidth("سلام دنیا", font);
    expect(fakeMeasureText).toHaveBeenCalledTimes(1);
    expect(measureCacheSize()).toBe(1);

    const again = measureLineWidth("سلام دنیا", font);
    expect(again).toBe("سلام دنیا".length * 10);
    expect(fakeMeasureText).toHaveBeenCalledTimes(1); // بدونِ اندازه‌گیریِ دوباره
    expect(measureCacheSize()).toBe(1);
  });

  it("کلیدِ کش شاملِ فونت است — همان متن با فونتِ متفاوت، ورودیِ جدا", () => {
    measureLineWidth("متن", "16px Vazirmatn");
    measureLineWidth("متن", "24px Vazirmatn");
    expect(measureCacheSize()).toBe(2);
    expect(fakeMeasureText).toHaveBeenCalledTimes(2);
  });

  it("با عبور از سقفِ کش، یک‌جا پاک می‌شود (نه رشدِ بی‌نهایت)", () => {
    const font = "16px Vazirmatn";
    // سقفِ CACHE_LIMIT برابر ۵۰۰۰ است؛ ۵۰۰۰ کلیدِ یکتا پرش می‌کند.
    for (let i = 0; i < 5000; i++) measureLineWidth(`line-${i}`, font);
    expect(measureCacheSize()).toBe(5000);
    // ورودیِ ۵۰۰۱‌ام: size >= LIMIT → clear، بعد این یکی افزوده می‌شود.
    measureLineWidth("line-overflow", font);
    expect(measureCacheSize()).toBe(1);
  });

  it("clearMeasureCache کش را خالی می‌کند", () => {
    measureLineWidth("چیزی", "16px Vazirmatn");
    expect(measureCacheSize()).toBe(1);
    clearMeasureCache();
    expect(measureCacheSize()).toBe(0);
  });
});
