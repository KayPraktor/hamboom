import { buildApp } from "./app.ts";

/**
 * نقطه‌ی ورودِ سرورِ api (dev). ماژول M3، گام ۵٫۱.
 *
 * ⚠️ **فعلاً فقط `/healthz` و `/readyz`.** endpointهای auth/user/team/board
 * (فازهای ۵٫۲–۵٫۴) هنوز نیامده‌اند.
 *
 * پورت فعلاً ثابت است (۳۰۰۲، کنارِ realtimeِ ۳۰۰۱)؛ `API_PORT`ِ config در گامِ بعد.
 */
const PORT = 3002;

const app = await buildApp();

try {
  await app.listen({ port: PORT, host: "0.0.0.0" });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
