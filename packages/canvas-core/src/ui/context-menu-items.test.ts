import { fa } from "@hamboom/i18n";
import { describe, expect, it } from "vitest";

import { HB_MENU_ITEMS, isMenuItemEnabled } from "./context-menu-items";

describe("HB_MENU_ITEMS", () => {
  it("★ هر labelKey در کاتالوگِ فارسی هست", () => {
    for (const item of HB_MENU_ITEMS) {
      expect(item.labelKey in fa).toBe(true);
    }
  });

  it("شناسه‌ها یکتا اند", () => {
    const ids = HB_MENU_ITEMS.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("isMenuItemEnabled", () => {
  const del = HB_MENU_ITEMS.find((i) => i.id === "delete")!;
  const copyAsImage = HB_MENU_ITEMS.find((i) => i.id === "copyAsImage")!;
  const paste = HB_MENU_ITEMS.find((i) => i.id === "paste")!;

  it("★ آیتمِ نیازمندِ انتخاب، بدونِ انتخاب غیرفعال است", () => {
    expect(isMenuItemEnabled(del, false)).toBe(false);
    expect(isMenuItemEnabled(del, true)).toBe(true);
  });

  it("★ آیتمِ coming-soon همیشه غیرفعال است", () => {
    expect(isMenuItemEnabled(copyAsImage, true)).toBe(false);
  });

  it("paste نیازی به انتخاب ندارد (ولی فعلاً coming-soon)", () => {
    expect(paste.requiresSelection).toBe(false);
    expect(isMenuItemEnabled(paste, false)).toBe(false); // چون coming-soon
  });
});
