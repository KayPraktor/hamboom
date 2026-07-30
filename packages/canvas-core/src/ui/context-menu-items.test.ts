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

  it("★ paste بدونِ انتخاب هم فعال است (نیازی به انتخاب ندارد، coming-soon هم نیست — ۵٫۳)", () => {
    expect(paste.requiresSelection).toBe(false);
    expect(paste.comingSoon).toBeUndefined();
    expect(isMenuItemEnabled(paste, false)).toBe(true);
  });

  it("★ copy نیازمندِ انتخاب است و coming-soon نیست (۵٫۳)", () => {
    const copy = HB_MENU_ITEMS.find((i) => i.id === "copy")!;
    expect(isMenuItemEnabled(copy, false)).toBe(false);
    expect(isMenuItemEnabled(copy, true)).toBe(true);
  });
});
