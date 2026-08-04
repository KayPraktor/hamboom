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
    // ★ عمداً **بیرونِ بازه‌ی dynamic port** ویندوز.
    //
    // Hyper-V/WSL محدوده‌هایی از آن بازه را رزرو می‌کند و `bind` رویشان `EACCES`
    // می‌دهد؛ این محدوده‌ها **با هر بوت عوض می‌شوند**، پس پورتِ ۵۱۸۰ی قبلی یک روز
    // کار می‌کرد و روزِ بعد نه — و تستِ E2E بدونِ هیچ تغییری در کد قرمز می‌شد.
    // ۱۵۱۸۰ هم بالای بازه‌ی این ماشین (۱۰۲۴–۱۵۰۰۰) است و هم زیرِ بازه‌ی پیش‌فرضِ
    // ویندوز (۴۹۱۵۲–۶۵۵۳۵) — یعنی روی هر دو پیکربندی امن است.
    // شبکه‌ی ایمنی: `scripts/check-dev-port.mjs` در هوکِ `predev`.
    port: 15180,
    // اگر پورت آزاد نبود، بی‌صدا روی پورتِ بعدی نرو — Playwright به همین آدرس وصل
    // می‌شود و یک جابه‌جاییِ خاموش، خطا را به «سرور بالا نیامد» تبدیل می‌کند.
    strictPort: true,
    host: "127.0.0.1",
  },
  build: {
    outDir: fileURLToPath(new URL("./dist/demo", import.meta.url)),
    emptyOutDir: true,
  },
});
