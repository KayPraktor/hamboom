import { fileURLToPath } from "node:url";

import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

import { API_PREFIXES } from "./src/api-prefixes.ts";

/**
 * پیکربندیِ اپِ وبِ هم‌بوم.
 *
 * برخلافِ دموی `canvas-core` (که `root` را روی `dev/` می‌بَرد)، این یک اپِ واقعی
 * است و ریشه‌اش خودِ پکیج است — `index.html` کنارِ همین فایل.
 *
 * ★ **پروکسیِ dev به api** ([apps/api](../api)، پیش‌فرض `localhost:3002`): `baseUrl`ِ
 * sdk عمداً `""` (هم‌مبدأ) است، پس مرورگر همه‌چیز را روی ۱۵۳۸۰ می‌بیند و کوکیِ
 * refreshِ HttpOnly (path=`/auth`) بی‌دردسر برمی‌گردد — بدونِ CORS و **بدونِ
 * rewrite** (rewrite مسیرِ کوکی را می‌شکست). مسیرها بی‌تغییر forward می‌شوند.
 *
 * ★★ **فهرستِ پیشوندها این‌جا نیست** (M5 گام ۲٫۳): در [`src/api-prefixes.ts`](./src/api-prefixes.ts)
 * است، چون reverse proxyِ production هم از همان تولید می‌شود و
 * [`scripts/infra-check-proxy.ts`](../../scripts/infra-check-proxy.ts) هر سه را با
 * مسیرهای **واقعیِ** ثبت‌شده‌ی api مقایسه می‌کند.
 */

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, fileURLToPath(new URL(".", import.meta.url)), "VITE_");
  const apiTarget = env.VITE_API_TARGET ?? "http://localhost:3002";
  const proxy = Object.fromEntries(
    API_PREFIXES.map((p) => [p, { target: apiTarget, changeOrigin: true }]),
  );

  return {
    plugins: [react()],
    server: {
      // ★ عمداً بیرونِ بازه‌ی dynamic portِ ویندوز (مثلِ canvas-core=15180، canvas-sync=15280).
      //   بالای ۱۵۰۰۰ و زیرِ ۴۹۱۵۲ — روی هر دو پیکربندیِ ویندوز امن. شبکه‌ی ایمنی:
      //   `scripts/check-dev-port.mjs` در هوکِ `predev`.
      port: 15380,
      strictPort: true,
      host: "127.0.0.1",
      proxy,
    },
    build: {
      /**
       * ★★ **عمداً `static` است، نه پیش‌فرضِ `assets`** (M5 گام ۲٫۲).
       *
       * پیش‌فرضِ Vite خروجی را در `dist/assets/` می‌گذارد ⇒ مرورگر باندل را از
       * `/assets/index-<hash>.js` می‌خواهد. ولی **`/assets` یکی از پیشوندهای api است**
       * (`GET /assets/:fileId`)، پس reverse proxyِ production کلِ باندلِ JS/CSS را به api
       * می‌فرستاد و اپ **هرگز بالا نمی‌آمد**. در dev هیچ‌وقت دیده نمی‌شود، چون سرورِ dev
       * اصلاً `/assets/*` تولید نمی‌کند — یعنی نقصی که فقط ایمیجِ production نشانش می‌دهد.
       */
      assetsDir: "static",
      // ⚠️ sourcemap برای دیباگِ production؛ حجم مسئله‌ی این فاز نیست.
      sourcemap: true,
    },
  };
});
