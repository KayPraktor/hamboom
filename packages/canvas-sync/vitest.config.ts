import { fileURLToPath } from "node:url";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

const CANVAS_CORE_SRC = fileURLToPath(new URL("../canvas-core/src", import.meta.url));

/**
 * جدا از `vite.config.ts` نگه داشته می‌شود — آن فایل `root` را روی `dev/` می‌برد
 * و تست‌ها باید از ریشه‌ی پکیج اجرا شوند (همان تفکیکی که canvas-core دارد).
 */
export default defineConfig({
  // بعضی تست‌ها خروجیِ سازنده‌های واقعیِ M1 را مصرف می‌کنند و آن مسیر به فایل‌های
  // `.tsx` می‌رسد.
  plugins: [react()],
  resolve: {
    // نامِ واقعیِ پکیج به‌جای مسیرِ نسبی، تا نگاشتِ exports هم آزموده شود.
    alias: [
      { find: /^@hamboom\/canvas-core\/sync$/, replacement: `${CANVAS_CORE_SRC}/sync/index.ts` },
      { find: /^@hamboom\/canvas-core$/, replacement: `${CANVAS_CORE_SRC}/index.ts` },
    ],
  },
  test: {
    environment: "node",
    // Excalidraw هنگامِ لودِ ماژول `getContext("2d")` می‌زند؛ jsdom آن را ندارد.
    // stub از canvas-core قرض گرفته می‌شود — جزئیات در `test/setup.ts`.
    setupFiles: ["./test/setup.ts"],
    include: ["src/**/*.test.ts"],
    restoreMocks: true,
    clearMocks: true,
    server: {
      deps: {
        // ⚠️ تله‌ی ثبت‌شده‌ی M1 (`canvas-core/vitest.config.ts`): Excalidraw یک فایل
        // JSON را بدونِ `with { type: "json" }` وارد می‌کند. Node در حالتِ ESM ردش
        // می‌کند، ولی Vite خودش JSON را هندل می‌کند — پس باید از مسیرِ externalize
        // خارج شود. بدونِ این، هر تستی که سازنده‌های M1 را import کند می‌افتد.
        inline: ["@excalidraw/excalidraw"],
      },
    },
  },
});
