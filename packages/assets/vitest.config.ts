import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    // فقط تست‌های واحدِ `src/` — `smoke/` بیرونِ verify است (MinIO لازم دارد).
    include: ["src/**/*.test.ts"],
    restoreMocks: true,
    clearMocks: true,
  },
});
