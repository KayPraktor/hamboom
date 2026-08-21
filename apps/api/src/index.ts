/**
 * `@hamboom/api` — REST APIِ اصلی (Fastify). ماژول M3، فاز ۵.
 *
 * ── اسکلتِ گام ۵٫۰: «مرز قبل از کد» ───────────────────────────────────
 *
 * این ماژول عمداً هنوز خالی است. گام ۵٫۰ فقط دو چیز را تثبیت می‌کند: خانه‌ی
 * `apps/api` و **گیتِ خودآزمونِ `apiBoundaries`** (در `@hamboom/eslint-config`) —
 * تا P4 و مرزِ لایه‌ها **پیش از** نوشتنِ هر endpoint قفل باشد.
 *
 * از گام ۵٫۱ به بعد اینجا پر می‌شود: `buildApp()`ِ تست‌پذیر (بدونِ `listen`) +
 * پلاگین‌ها (db/redis/s3/auth-guard/rate-limit/request-id/error + pino و redactorِ P7)،
 * migrationِ کاملِ schema + دو FKِ به‌ارث‌رسیده، پیاده‌سازیِ DBِ پورت‌های فاز ۳/۴، و
 * endpointهای auth/user/team/board/asset + `GET /boards/:id/rt-token`.
 */
export const API_MODULE = "@hamboom/api" as const;
