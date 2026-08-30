import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

/**
 * تست‌های واحدِ کامپوننت — محیطِ jsdom.
 *
 * `passWithNoTests` عمداً روشن است: اسکلتِ فاز ۸٫۱ هنوز منطقِ آزمودنی ندارد؛ با
 * آمدنِ احراز/داشبورد (۸٫۲+) تست‌های واقعی اضافه می‌شوند. گیتِ `test` نباید روی
 * «هنوز تستی نیست» قرمز شود.
 */
export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test-setup.ts"],
    passWithNoTests: true,
    css: false,
  },
});
