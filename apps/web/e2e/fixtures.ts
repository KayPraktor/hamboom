import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * قرارداد بینِ `global-setup` و خودِ تست‌ها — M6 ردیفِ ۸٫۱.
 *
 * ★★ **شماره‌های تلفن در هر اجرا تازه ساخته می‌شوند و در پایان پاک.**
 * دلیلش یک درسِ همین‌روز است: دو سنجه‌ی دیگرِ همین فاز به دیتابیسِ تمیز وابسته بودند و یک
 * اجرای شکسته، اجرای بعدی را هم می‌شکست. با شماره‌ی تازه، تصادمِ بینِ اجراها **ساختاراً**
 * ناممکن است، نه اینکه به یادآوریِ پاک‌سازی تکیه کند.
 */
export interface PanelFixtures {
  /** staff — پرچمش با `admin:grant-staff` گرفته شده (تنها نویسنده‌ی `is_staff`). */
  staffPhone: string;
  staffUserId: string;
  /** کاربرِ هدفِ جست‌وجو/تعلیق/نمای پشتیبانی. */
  targetPhone: string;
  targetUserId: string;
  targetTeamId: string;
  targetBoardId: string;
  /** پرداختِ `pending`ِ mock که با verifyِ دستیِ پنل تسویه می‌شود. */
  paymentId: string;
  /** کاربرِ سومِ **غیرِ staff** — برای اثباتِ اینکه `/panel` را نمی‌بیند. */
  plainPhone: string;
  plainUserId: string;
}

export const FIXTURES_PATH = join(import.meta.dirname, ".fixtures.json");

export const readFixtures = (): PanelFixtures =>
  JSON.parse(readFileSync(FIXTURES_PATH, "utf8")) as PanelFixtures;

/** کدِ ثابتِ dev — `OTP_DEV_FIXED_CODE` در `.env`. بدونش این تست به لاگِ سرور وابسته می‌شد. */
export const OTP_CODE = "424242";
