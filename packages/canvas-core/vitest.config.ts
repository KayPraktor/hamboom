import { fileURLToPath } from "node:url";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

const SRC = fileURLToPath(new URL("./src", import.meta.url));

/**
 * پیکربندی تست جدا از vite.config.ts نگه داشته می‌شود چون آن فایل `root` را
 * روی dev/ می‌برد و تست‌ها باید از ریشه‌ی پکیج اجرا شوند.
 */
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: [
      { find: /^@hamboom\/canvas-core\/sync$/, replacement: `${SRC}/sync/index.ts` },
      { find: /^@hamboom\/canvas-core$/, replacement: `${SRC}/index.ts` },
    ],
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./test/setup.ts"],
    include: ["src/**/*.test.{ts,tsx}", "test/**/*.test.{ts,tsx}"],
    restoreMocks: true,
    clearMocks: true,
  },
});
