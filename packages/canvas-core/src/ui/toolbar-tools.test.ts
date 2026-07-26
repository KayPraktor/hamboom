import { fa } from "@hamboom/i18n";
import { describe, expect, it } from "vitest";

import { HB_TOOLS, toolForShortcut } from "./toolbar-tools";

describe("HB_TOOLS", () => {
  it("★ ۱۱ ابزار با شناسه‌های یکتا", () => {
    expect(HB_TOOLS).toHaveLength(11);
    expect(new Set(HB_TOOLS.map((t) => t.id)).size).toBe(11);
  });

  it("★ میانبرها یکتا و تک‌حرفی‌اند", () => {
    const shortcuts = HB_TOOLS.map((t) => t.shortcut);
    expect(new Set(shortcuts).size).toBe(shortcuts.length);
    for (const s of shortcuts) expect(s).toMatch(/^[a-z]$/);
  });

  it("★ هر labelKey در کاتالوگِ فارسی وجود دارد (نوار و i18n از هم جدا نشوند)", () => {
    for (const tool of HB_TOOLS) {
      expect(tool.labelKey in fa).toBe(true);
    }
  });
});

describe("toolForShortcut", () => {
  it("★ حرفِ بزرگ/کوچک مهم نیست", () => {
    expect(toolForShortcut("v")).toBe("select");
    expect(toolForShortcut("V")).toBe("select");
    expect(toolForShortcut("N")).toBe("sticky");
    expect(toolForShortcut("P")).toBe("pen");
  });

  it("کلیدِ بدونِ ابزار، undefined", () => {
    expect(toolForShortcut("z")).toBeUndefined();
    expect(toolForShortcut("Escape")).toBeUndefined();
  });
});
