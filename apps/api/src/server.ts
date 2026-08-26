import { buildApp } from "./app.ts";
import { loadApiConfig } from "./config.ts";

/**
 * نقطه‌ی ورودِ سرورِ api (dev). ماژول M3، فاز ۵.
 *
 * ★ پورت از config می‌آید (`PORT`، پیش‌فرض ۳۰۰۲) — نه hard-code. ابزارِ preview/میزبانی پورتِ آزاد
 * را با `PORT` تزریق می‌کند و سرور همان را می‌گیرد، پس با اجرای دستیِ همزمان تداخل نمی‌کند.
 */
const config = loadApiConfig();
const app = await buildApp({ config });

try {
  await app.listen({ port: config.PORT, host: "0.0.0.0" });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
