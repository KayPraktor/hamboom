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
      // ⚠️ داربستِ تست از مخرج بیرون است. `test-fixtures.ts` صادر نمی‌شود و فقط
      //   تست‌ها صدایش می‌زنند؛ شمردنش عدد را بالا می‌برد بدونِ اینکه یک خطِ
      //   محصولی بیشتر آزموده شده باشد.
      exclude: ["src/**/*.test.ts", "src/test-fixtures.ts"],
      reporter: ["text", "json-summary"],
      // ★ گیتِ گام ۶٫۲ — عددِ ادعایی نیست: زیرِ ۶۰٪ اجرا **می‌شکند**.
      thresholds: { lines: 60, functions: 60, statements: 60, branches: 60 },
    },
  },
});
