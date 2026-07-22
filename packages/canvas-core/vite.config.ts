import { fileURLToPath } from "node:url";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const SRC = fileURLToPath(new URL("./src", import.meta.url));

/**
 * پیکربندی اپ دموی canvas-core.
 *
 * دمو عمداً داخل خود پکیج زندگی می‌کند (نه در apps/) چون فقط ابزار توسعه‌ی
 * همین ماژول است و هرگز دیپلوی نمی‌شود. `root` روی dev/ ست شده تا ریشه‌ی
 * پکیج تمیز بماند.
 */
export default defineConfig({
  root: fileURLToPath(new URL("./dev", import.meta.url)),
  plugins: [react()],
  resolve: {
    // نام واقعی پکیج به‌جای مسیر نسبی، تا نگاشت exports هم آزموده شود.
    alias: [
      { find: /^@hamboom\/canvas-core\/sync$/, replacement: `${SRC}/sync/index.ts` },
      { find: /^@hamboom\/canvas-core$/, replacement: `${SRC}/index.ts` },
    ],
  },
  server: {
    port: 5180,
    host: "127.0.0.1",
  },
  build: {
    outDir: fileURLToPath(new URL("./dist/demo", import.meta.url)),
    emptyOutDir: true,
  },
});
