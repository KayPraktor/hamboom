/**
 * `@hamboom/api` — REST APIِ اصلی (Fastify). ماژول M3، فاز ۵.
 *
 * گام ۵٫۰ مرزِ پکیج + گیتِ `apiBoundaries` را قفل کرد؛ گام ۵٫۱ اسکلتِ `buildApp()` +
 * پلاگین‌های پایه (db با کوئرسِ int8/P5، loggerِ redactِ P7، خطای یکسان) + `/healthz`/`/readyz`
 * را افزود. adapterهای DBِ پورت‌ها و endpointها از گام ۵٫۲ به بعد.
 */
export { buildApp, type BuildAppOptions } from "./app.ts";
export { HttpError, httpErrors } from "./errors.ts";
export { loadApiConfig, type ApiConfig } from "./config.ts";

export const API_MODULE = "@hamboom/api" as const;
