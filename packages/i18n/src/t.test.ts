import { afterEach, describe, expect, it } from "vitest";

import { getLocale, setLocale, t } from "./t";

afterEach(() => setLocale("fa"));

describe("t", () => {
  it("★ رشته‌ی ساده", () => {
    expect(t("app.name")).toBe("هم‌بوم");
  });

  it("★ درجِ پارامتر، با عددِ فارسی‌شده (P6)", () => {
    expect(t("connection.connected", { count: 3 })).toBe("متصل — ۳ نفر آنلاین");
  });

  it("پارامترِ رشته‌ای دست‌نخورده درج می‌شود", () => {
    expect(t("element.imageBadType", { type: "image/bmp" })).toBe(
      "این فرمت پشتیبانی نمی‌شود: image/bmp",
    );
  });

  it("★ کلیدِ ناموجود، خودِ کلید را برمی‌گرداند (نبودِ ترجمه دیده شود)", () => {
    expect(t("nope.missing.key")).toBe("nope.missing.key");
  });

  it("بدونِ پارامتر، placeholder دست‌نخورده می‌ماند", () => {
    expect(t("connection.connected")).toContain("{count}");
  });

  it("پارامترِ نبوده در params، placeholder را نگه می‌دارد", () => {
    expect(t("connection.offline", {})).toContain("{pending}");
  });

  it("locale پیش‌فرض fa است", () => {
    expect(getLocale()).toBe("fa");
  });
});
