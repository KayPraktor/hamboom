import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    restoreMocks: true,
    clearMocks: true,
    coverage: {
      provider: "v8",
      include: ["src/**"],
      exclude: ["src/**/*.test.ts", "src/index.ts"],
      reporter: ["text", "json-summary"],
      // ★★ گیتِ ۹۰٪ — نه ۶۰٪ی بقیه ([ADR-049](../../ARCHITECTURE_DECISIONS.md#adr-049)).
      //    خطِ بی‌پوشش در ریاضیِ پول با خطِ بی‌پوششِ UI یکی نیست. عدد **کف** است، نه هدف.
      thresholds: { lines: 90, functions: 90, statements: 90, branches: 90 },
    },
  },
});
