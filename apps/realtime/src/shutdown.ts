import { createLogger, type Logger } from "./log.ts";
import type { RoomManager } from "./room.ts";
import type { RtServer } from "./server.ts";

/**
 * خاموشیِ مودبانه — گام ۴٫۸، الزاماتِ K8s در
 * [ADR-006](../../../ARCHITECTURE_DECISIONS.md#adr-006).
 *
 * ── ★★ چرا این یک ماژولِ جداست و نه چند خط در `main.ts` ───────────────
 *
 * **ترتیب، کلِ ادعای این گام است** — و `main.ts` عمداً جایی است که تست به آن
 * نمی‌رسد (توضیحش در خودِ آن فایل). پس اگر ترتیب آنجا می‌ماند، تنها گیتش
 * «حواسم بود» بود.
 *
 * ⚠️ و روی **ویندوز** حتی سنجه‌ی زنده هم نمی‌تواند `SIGTERM` بفرستد:
 * `child.kill("SIGTERM")` آنجا فرایند را **بی‌درنگ** می‌کشد و هیچ handlerی اجرا
 * نمی‌شود (آزموده شد: `exit code=1 signal=null`، بدونِ اجرای handler). یعنی
 * تنها راهِ آزمودنِ این ترتیب روی ماشینِ توسعه، صدا زدنِ **همین تابع** است.
 * تحویلِ خودِ سیگنال کارِ سیستم‌عامل است و روی لینوکس/K8s رفتارِ استانداردِ Node.
 *
 * ── ترتیب، و چرا هر قدم همان‌جاست ─────────────────────────────────────
 *
 * ۱. **`server.shutdown()`** — `/readyz` قرمز می‌شود (لودبالانسر ما را کنار
 *    می‌گذارد)، اتصالِ تازه رد می‌شود، و کلاینت‌ها با **۱۰۰۱ Going Away** بدرقه
 *    می‌شوند تا **فوراً** به نودِ دیگر بروند.
 * ۲. **`rooms.close()`** — نوشتن‌های در جریان تخلیه، snapshot گرفته، و قفلِ
 *    صاحب پس داده می‌شود.
 * ۳. **`closeResources()`** — استخرِ Postgres و اتصال‌های Redis.
 *
 * ⚠️ اگر ۲ قبل از ۱ می‌آمد، کلاینت‌ها هنوز وصل بودند و صفِ نوشتن هیچ‌وقت خالی
 * نمی‌شد — «تخلیه» به انتظارِ بی‌پایان تبدیل می‌شد.
 */

export interface GracefulShutdownOptions {
  server: Pick<RtServer, "shutdown" | "close">;
  rooms: Pick<RoomManager, "close">;
  /** بستنِ منابعِ بیرونی — **آخرین** قدم، بعد از تخلیه و snapshot. */
  closeResources?: () => Promise<void>;
  logger?: Logger;
}

export async function gracefulShutdown({
  server,
  rooms,
  closeResources,
  logger = createLogger(),
}: GracefulShutdownOptions): Promise<void> {
  // ۱) از لودبالانسر بیرون برو و کلاینت‌ها را بدرقه کن.
  await server.shutdown();

  // ۲) کارِ نیمه‌تمام را تمام کن: تخلیه، snapshot، رهاکردنِ قفل.
  //
  // ⚠️ هر شکستی اینجا **نباید** جلوی بقیه‌ی خاموشی را بگیرد: نودی که گیر کند،
  //    قفلش را هم پس نمی‌دهد و بورد تا انقضای اجاره بی‌صاحب می‌مانَد.
  try {
    await rooms.close();
  } catch (cause) {
    logger.error("خاموشی: بستنِ اتاق‌ها تمیز نبود", { error: String(cause) });
  }

  // ۳) و تازه حالا منابع.
  try {
    await server.close();
    await closeResources?.();
  } catch (cause) {
    logger.error("خاموشی: بستنِ منابع تمیز نبود", { error: String(cause) });
  }
}
