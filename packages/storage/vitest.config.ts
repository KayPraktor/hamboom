import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    // فقط تست‌های واحدِ `src/` — `probe/` و `smoke/` بیرونِ verify‌اند (MinIO لازم دارند).
    include: ["src/**/*.test.ts"],
    restoreMocks: true,
    clearMocks: true,
  },
});
