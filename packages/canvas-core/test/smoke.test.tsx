import {
  CANVAS_CORE_NAME,
  ENGINE_STAGE,
  assertAssetPathConfigured,
  configureExcalidrawAssetPath,
  isAssetPathConfigured,
} from "@hamboom/canvas-core";
import { SYNC_CONTRACT_VERSION } from "@hamboom/canvas-core/sync";
import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

/**
 * تست دود زیرساخت — منطق محصول را نمی‌آزماید.
 * هدف: اگر سیم‌کشی پکیج، alias، jsdom، RTL یا نگهبان P2 خراب شد، همین‌جا بشکند.
 *
 * توجه: `App` عمداً اینجا رندر نمی‌شود؛ از گام ۱٫۱ به بعد بوم واقعی را
 * می‌سازد و موتور رندر به canvas واقعی نیاز دارد که jsdom ندارد.
 * تست رندر بوم در گام ۶٫۱ با محیط مرورگر واقعی اضافه می‌شود.
 */

describe("سیم‌کشی پکیج canvas-core", () => {
  it("نقطه‌ی ورود اصلی از طریق نام پکیج قابل import است", () => {
    expect(CANVAS_CORE_NAME).toBe("@hamboom/canvas-core");
  });

  it("زیرمسیر sync جدا از نقطه‌ی ورود اصلی قابل import است", () => {
    // از گام ۲٫۲ برابر ۱ است — قبلش ۰ بود یعنی «قرارداد هنوز تعریف نشده».
    // بالا بردن این عدد یعنی تغییر ناسازگار؛ سرور realtime بر اساسش کلاینت
    // قدیمی را رد می‌کند، پس نباید بی‌دلیل عوض شود.
    expect(SYNC_CONTRACT_VERSION).toBe(1);
  });

  it("از پله‌ی npm در ADR-003 شروع می‌کند", () => {
    // اگر این تست شکست، یعنی کسی پله را عوض کرده — باید در PROGRESS.md ثبت شده باشد.
    expect(ENGINE_STAGE).toBe("npm");
  });
});

describe("نگهبان اصل P2 — مسیر دارایی‌های Excalidraw", () => {
  afterEach(() => {
    delete window.EXCALIDRAW_ASSET_PATH;
  });

  it("وقتی مسیر ست نشده، صریح خطا می‌دهد", () => {
    // بدون این نگهبان، Excalidraw بی‌صدا فونت‌ها را از esm.sh می‌گیرد —
    // نقض P2 و غیرقابل‌اتکا از داخل ایران.
    expect(isAssetPathConfigured()).toBe(false);
    expect(() => assertAssetPathConfigured()).toThrowError(/esm\.sh/);
  });

  it("رشته‌ی خالی به‌عنوان مسیر معتبر پذیرفته نمی‌شود", () => {
    configureExcalidrawAssetPath("");
    expect(isAssetPathConfigured()).toBe(false);
    expect(() => assertAssetPathConfigured()).toThrowError();
  });

  it("بعد از تنظیم مسیر، عبور می‌کند", () => {
    configureExcalidrawAssetPath("/excalidraw-assets/");
    expect(isAssetPathConfigured()).toBe(true);
    expect(() => assertAssetPathConfigured()).not.toThrow();
  });

  it("آرایه‌ای از مسیرها هم پذیرفته می‌شود (پشتیبانی بالادست)", () => {
    window.EXCALIDRAW_ASSET_PATH = ["/excalidraw-assets/"];
    expect(isAssetPathConfigured()).toBe(true);
  });
});

describe("محیط تست (React + jsdom + testing-library)", () => {
  it("سند در حالت RTL و فارسی اجرا می‌شود", () => {
    expect(document.documentElement).toHaveAttribute("dir", "rtl");
    expect(document.documentElement).toHaveAttribute("lang", "fa");
  });

  it("کامپوننت React رندر می‌شود و متن فارسی قابل جستجوست", () => {
    render(<h1>هم‌بوم</h1>);
    expect(screen.getByRole("heading", { level: 1, name: "هم‌بوم" })).toBeInTheDocument();
  });
});
