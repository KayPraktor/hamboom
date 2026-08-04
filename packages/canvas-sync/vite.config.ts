import { fileURLToPath } from "node:url";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const CANVAS_CORE_SRC = fileURLToPath(new URL("../canvas-core/src", import.meta.url));

/**
 * پیکربندیِ صفحه‌ی probe و (در فاز ۳) دموی دو-نمونه‌ایِ G-1.
 *
 * ⚠️ `publicDir` عمداً به `dev/public`ِ **canvas-core** اشاره می‌کند: فونت‌های
 * Excalidraw ۱۴ مگابایت فایلِ تولیدی‌اند که اسکریپتِ خودِ آن پکیج تولید می‌کند
 * (اصل P2 — بدون CDN خارجی). کپیِ دومشان اینجا فقط دو نسخه‌ی واگرا می‌سازد؛
 * `predev` اسکریپتِ همان پکیج را صدا می‌زند.
 */
export default defineConfig({
  root: fileURLToPath(new URL("./dev", import.meta.url)),
  publicDir: fileURLToPath(new URL("../canvas-core/dev/public", import.meta.url)),
  plugins: [react()],
  resolve: {
    alias: [
      { find: /^@hamboom\/canvas-core\/sync$/, replacement: `${CANVAS_CORE_SRC}/sync/index.ts` },
      { find: /^@hamboom\/canvas-core$/, replacement: `${CANVAS_CORE_SRC}/index.ts` },
    ],
  },
  server: {
    // ۵۱۸۰ مالِ دموی canvas-core است؛ این یکی باید بتواند کنارش بالا بیاید.
    //
    // ⚠️ چرا ۵۲۸۰ و نه ۵۱۸۱: ویندوز محدوده‌هایی از پورت‌ها را برای Hyper-V/WSL
    // **رزرو** می‌کند و bind رویشان `EACCES` می‌دهد. روی ماشینِ توسعه محدوده‌ی
    // ۵۱۴۸–۵۲۴۷ رزرو بود که هم ۵۱۸۱ و هم ۵۱۸۰ را می‌گیرد. این محدوده‌ها با هر بوت
    // عوض می‌شوند؛ اگر روزی اینجا هم `EACCES` دیدی:
    //   netsh interface ipv4 show excludedportrange protocol=tcp
    port: 5280,
    host: "127.0.0.1",
  },
});
