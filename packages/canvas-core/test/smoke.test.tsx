import { CANVAS_CORE_NAME, ENGINE_STAGE } from "@hamboom/canvas-core";
import { SYNC_CONTRACT_VERSION } from "@hamboom/canvas-core/sync";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { App } from "../dev/App";

/**
 * تست دود گام ۰٫۲ — این‌ها زیرساخت را می‌آزمایند، نه منطق محصول را.
 * هدف: اگر سیم‌کشی پکیج، alias، jsdom یا RTL خراب شد، همین‌جا بشکند.
 */
describe("سیم‌کشی پکیج canvas-core", () => {
  it("نقطه‌ی ورود اصلی از طریق نام پکیج قابل import است", () => {
    expect(CANVAS_CORE_NAME).toBe("@hamboom/canvas-core");
  });

  it("زیرمسیر sync جدا از نقطه‌ی ورود اصلی قابل import است", () => {
    // نگاشت exports دو مدخل دارد؛ اگر یکی بشکند این تست می‌گیرد.
    expect(SYNC_CONTRACT_VERSION).toBe(0);
  });

  it("از پله‌ی npm در ADR-003 شروع می‌کند", () => {
    // اگر این تست شکست، یعنی کسی پله را عوض کرده — باید در PROGRESS.md ثبت شده باشد.
    expect(ENGINE_STAGE).toBe("npm");
  });
});

describe("محیط تست (React + jsdom + testing-library)", () => {
  it("سند در حالت RTL و فارسی اجرا می‌شود", () => {
    expect(document.documentElement).toHaveAttribute("dir", "rtl");
    expect(document.documentElement).toHaveAttribute("lang", "fa");
  });

  it("کامپوننت React رندر می‌شود و متن فارسی قابل جستجوست", () => {
    render(<App />);
    expect(screen.getByRole("heading", { level: 1, name: "هم‌بوم" })).toBeInTheDocument();
  });

  it("مقادیر پکیج واقعاً در خروجی رندر می‌آیند", () => {
    render(<App />);
    expect(screen.getByText(CANVAS_CORE_NAME)).toBeInTheDocument();
    expect(screen.getByText(`${CANVAS_CORE_NAME}/sync`)).toBeInTheDocument();
  });
});
