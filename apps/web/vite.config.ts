import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

/**
 * پیکربندیِ اپِ وبِ هم‌بوم.
 *
 * برخلافِ دموی `canvas-core` (که `root` را روی `dev/` می‌بَرد)، این یک اپِ واقعی
 * است و ریشه‌اش خودِ پکیج است — `index.html` کنارِ همین فایل.
 */
export default defineConfig({
  plugins: [react()],
  server: {
    // ★ عمداً بیرونِ بازه‌ی dynamic portِ ویندوز (مثلِ canvas-core=15180، canvas-sync=15280).
    //   بالای ۱۵۰۰۰ و زیرِ ۴۹۱۵۲ — روی هر دو پیکربندیِ ویندوز امن. شبکه‌ی ایمنی:
    //   `scripts/check-dev-port.mjs` در هوکِ `predev`.
    port: 15380,
    strictPort: true,
    host: "127.0.0.1",
  },
  build: {
    // ⚠️ sourcemap برای دیباگِ production؛ حجم مسئله‌ی این فاز نیست.
    sourcemap: true,
  },
});
